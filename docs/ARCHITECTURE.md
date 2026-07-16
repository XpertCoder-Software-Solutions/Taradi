# Taradi Backend Architecture

Taradi is split into an API process and background worker processes. All processes share PostgreSQL through Prisma and Redis through BullMQ.

## API Server

Entry point: `src/server.js`

Responsibilities:

- Express REST API under `/api`
- Swagger UI under `/api/docs`
- JWT authentication, role checks, and dynamic permission guards
- Customer, employee, inbox, and message APIs
- Conversation Engine APIs under `/api/chats`
- WhatsApp webhook verification and inbound event queueing
- Socket.IO realtime notifications
- Queueing outbound WhatsApp messages and inbound webhook processing
- Structured HTTP logging through Pino
- Centralized JSON success and error formats
- API and auth rate limiting

The API does not send bulk campaign messages or process inbound webhooks directly in the request lifecycle. It creates durable database records and adds jobs to Redis.

## PostgreSQL

PostgreSQL is the system of record.

Stored data:

- Users and roles
- Permission catalog and `RolePermission` matrix
- Customers and assignments
- Conversations as the inbox source of truth
- Inbound and outbound messages
- Message media metadata and local media URLs
- WhatsApp message IDs and status history fields
- Per-user read state for unread counts

Prisma schema and migrations live in `prisma/`.

Performance index notes live in `docs/DATABASE_PERFORMANCE.md`.

## Conversation Engine

The Conversation Engine is the core Inbox layer.

Model:

- One active `Conversation` per `Customer` for the MVP
- `Conversation.customerId` is unique
- `Conversation.assignedEmployeeId` mirrors the active customer assignment
- `Conversation.lastMessageId` and `lastMessageAt` power inbox sorting
- `Conversation.unreadCount` stores unread inbound message count for the conversation
- `Conversation.status` supports `OPEN`, `PENDING`, and `CLOSED`
- `Conversation.priority` supports `LOW`, `NORMAL`, `HIGH`, and `URGENT`

Flow:

1. Customer creation or assignment ensures a matching conversation exists.
2. Assignment updates write to both `Customer.assignedToId` and `Conversation.assignedEmployeeId`.
3. Inbound WhatsApp messages find or create the customer, find or create the conversation, store a linked `Message`, increment `Conversation.unreadCount`, set status to `OPEN`, and emit Socket.IO updates.
4. Outbound manual replies and bulk templates store linked `Message` rows with `QUEUED` status, update last-message metadata, and enqueue BullMQ jobs.
5. When `Customer.collectionStatus` becomes `PAID` or `DO_NOT_CONTACT`, the API computes `contactBlocked=true`, closes the conversation, clears `unreadCount`, adds a system message, blocks manual sends, and excludes the customer from bulk campaigns.
6. `PATCH /api/chats/:customerId/read` clears `Conversation.unreadCount`.

## Media Handling

Supported media message types:

- `IMAGE`
- `AUDIO`
- `VOICE`
- `DOCUMENT`

Message media fields:

- `mediaUrl`: local URL under `/uploads/whatsapp`
- `mediaId`: WhatsApp Cloud API media id
- `mimeType`
- `fileName`
- `fileSize`
- `caption`
- `duration`, when available for audio/voice

Inbound media flow:

1. Webhook dispatcher accepts `text`, `image`, `audio`, and `document` WhatsApp messages.
2. The webhook service stores the WhatsApp media id and metadata.
3. The media service attempts to fetch the media URL from Meta and download the bytes using `WHATSAPP_TOKEN`.
4. If download succeeds and the MIME type is allowed, the file is stored under `uploads/whatsapp`.
5. If download fails, the message is still stored with WhatsApp media metadata so the event is not lost.

Outbound media flow:

1. Client sends `POST /api/chats/:customerId/messages/media` as `multipart/form-data`.
2. API validates customer/conversation access before saving the file.
3. Multer enforces size limits and MIME allow-listing.
4. File bytes are saved locally under `uploads/whatsapp` with a generated name.
5. API creates a queued outbound `Message` linked to the conversation.
6. Worker uploads the local file to WhatsApp Cloud API.
7. Worker sends the correct WhatsApp message type: image, audio, or document.
8. Worker stores `mediaId`, `whatsappMessageId`, and final status on the message.

Local uploads are served from `/uploads`; directory listing is disabled and responses use `X-Content-Type-Options: nosniff`.

## Roles, Permissions, And Data Scope

Roles define the user's coarse identity:

- `ADMIN`: full access, cannot be restricted by dynamic permissions.
- `SUPERVISOR`: can login with email + password, has no employee code, and can see assigned team data when the relevant team permission is enabled.
- `EMPLOYEE`: can login with `employeeCode`, can see only directly assigned data.

Dynamic permissions define allowed actions for `SUPERVISOR` and `EMPLOYEE`. They are stored in:

- `Permission`: normalized permission catalog with Arabic labels, descriptions, and category.
- `RolePermission`: enabled/disabled matrix by role and permission key.

Admins manage the matrix through:

- `GET /api/settings/permissions`
- `PATCH /api/settings/permissions`

Data scope is enforced after permission checks:

- Admin reads and updates all conversations, including unassigned conversations.
- Supervisor can read and update conversations/customers assigned to himself or direct-report employees when team view is enabled.
- Employee reads, updates, and sends only on conversations assigned to that employee.
- Unassigned inbound conversations are visible only to admins.

## Redis

Redis is used by BullMQ for background jobs and as the preferred shared store for API rate limiting.

Local Redis is provided by `docker-compose.yml` at:

```text
redis://localhost:6379
```

## BullMQ

Queue names:

```text
whatsapp-outbound
whatsapp-webhook-processing
```

Producers:

- API server via `src/queues/whatsapp.queue.js`
- API server via `src/queues/webhook.queue.js`

Consumers:

- Worker process via `src/workers/whatsapp.worker.js`
- Worker process via `src/workers/whatsapp-webhook.worker.js`

Each outbound message job contains a database `messageId`. The worker loads the message from PostgreSQL, sends it through WhatsApp Cloud API, then updates the message status.

Each webhook job contains a `WebhookEvent.id`. The webhook worker loads the audited payload from PostgreSQL, dispatches it to the event-specific handler, and lets BullMQ retry transient failures.

## WhatsApp Webhook

Routes:

- `GET /api/whatsapp/webhook`
- `POST /api/whatsapp/webhook`
- `GET /api/whatsapp/templates`
- `POST /api/whatsapp/templates/sync`
- `POST /api/whatsapp/messages/template`

The GET route returns Meta's challenge string for webhook verification.

The POST route safely handles:

- Inbound text messages
- Inbound image, audio/voice, and document messages
- Message status updates: `sent`, `delivered`, `read`, `failed`
- Template status updates
- Template quality updates
- Template components updates
- Phone number quality updates

## WhatsApp Templates

`WhatsappTemplate` stores Meta-approved template definitions locally for fast CRM browsing and sending. The API sync calls `/{WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`, follows Meta pagination, and upserts by `metaTemplateId` or `name + language` to avoid duplicates.

The API lists approved templates by default, while `status=ALL` returns every synced status. Admins can trigger manual sync, and the server schedules an automatic sync every six hours. Single template sends use the synced record as the source of truth, validate the template is `APPROVED`, build body/header/button text parameters from stored variables, send through `/{WHATSAPP_PHONE_NUMBER_ID}/messages`, then save the outbound `Message` and emit the normal chat realtime events.
- Account alerts
- Calls events, which are intentionally ignored for now
- Unknown or malformed payloads without crashing
- Duplicate inbound message delivery using unique `whatsappMessageId`

New inbound customers are created as unassigned and visible only to admins until assignment.

Inbound messages are linked to `Conversation` and update `lastMessageId`, `lastMessageAt`, `unreadCount`, and `status`.

Outbound protection is enforced at request time and again in the WhatsApp worker. A queued outbound message will fail before reaching WhatsApp if the related customer becomes contact-blocked after queueing.

## Webhook Dispatcher

Webhook POST requests are handled by a dispatcher layer:

```text
POST /api/whatsapp/webhook
  -> signature middleware, if enabled
  -> create WebhookEvent audit row
  -> detect event type
  -> enqueue whatsapp-webhook-processing job
  -> return HTTP success to Meta
  -> webhook worker dispatcher
  -> event-specific handler
  -> update WebhookEvent status
```

Handlers live in `src/webhooks/handlers/`:

- `messages.handler.js`
- `messageStatus.handler.js`
- `templateStatus.handler.js`
- `templateQuality.handler.js`
- `templateComponents.handler.js`
- `phoneNumberQuality.handler.js`
- `accountAlerts.handler.js`
- `calls.handler.js`
- `unknown.handler.js`

`calls` is subscribed in Meta but not implemented in the CRM. It is accepted, audited, logged, and marked `IGNORED`.

## Webhook Audit Log

Every accepted POST webhook request creates a `WebhookEvent` row before dispatch.

Stored fields include:

- provider
- event type
- optional WhatsApp message id
- full JSON payload
- sanitized headers
- status: `RECEIVED`, `PROCESSED`, `FAILED`, or `IGNORED`
- error message, when failed
- processed timestamp

This gives the CRM a replay/debug trail before connecting production WhatsApp traffic.

## Webhook Idempotency

Inbound and outbound WhatsApp message IDs are stored as `Message.whatsappMessageId`, which is unique.

If Meta retries the same inbound message:

- the existing message is reused
- no duplicate message row is created
- Socket.IO is not emitted again
- unread counts are not double-incremented because duplicate messages skip conversation updates
- the audit event is completed safely

## Meta Signature Verification

Signature verification is optional for local development.

Environment:

```env
META_APP_SECRET=
VERIFY_META_SIGNATURE=false
```

When `VERIFY_META_SIGNATURE=true`, the backend validates `X-Hub-Signature-256` with HMAC SHA256 against the raw request body using `META_APP_SECRET`. Invalid or missing signatures return `401`.

## Socket.IO Notifications

Socket.IO is attached to the HTTP server.

Rooms:

- `admins`
- `user:{userId}`

Events:

- `message:received`
- `message:sent`
- `message:status`
- `inbox:updated`
- `socket:ready`

Admins receive all conversation events. Supervisors receive events for assigned direct-report customers when the event payload includes the assigned user. Employees receive only events for assigned customers.

## Worker Flow

1. A user sends a manual reply or creates a bulk template campaign.
2. API validates customer access.
3. API ensures a `Conversation` exists for each customer.
4. API creates one outbound `Message` row per customer with `QUEUED` status and links it to the conversation.
5. API updates conversation last-message metadata without incrementing unread count.
6. API enqueues one BullMQ job per message.
7. Worker consumes jobs from Redis.
8. Worker uploads media first when the message is media-backed.
9. Worker sends each message through WhatsApp Cloud API.
10. Worker updates the `Message` row to `SENT` or `FAILED`.
11. WhatsApp status webhooks later update messages to `DELIVERED`, `READ`, or `FAILED` when Meta sends those events.

## Logging

Pino is used for structured logs.

The backend logs:

- HTTP requests
- Webhook event summaries
- Outbound WhatsApp API request/response metadata
- Queue enqueue and worker processing events
- Errors through central error middleware

Sensitive fields such as tokens, authorization headers, passwords, and password hashes are redacted.
