# Taradi WhatsApp CRM Backend

Clean Node.js backend MVP for Taradi's WhatsApp CRM.

## Stack

- Node.js + Express.js
- PostgreSQL + Prisma ORM
- Redis + BullMQ queues
- Socket.IO
- JWT authentication
- Pino structured logging
- WhatsApp Cloud API

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

3. Start local infrastructure:

   ```bash
   docker compose up -d
   ```

4. Generate the Prisma client:

   ```bash
   npm run prisma:generate
   ```

5. Run database migrations:

   ```bash
   npm run prisma:migrate
   ```

6. Seed the first admin:

   ```bash
   npm run prisma:seed
   ```

7. Start the API:

   ```bash
   npm run dev
   ```

8. In a second terminal, start the WhatsApp outbound worker:

   ```bash
   npm run worker:whatsapp
   ```

9. In a third terminal, start the WhatsApp webhook worker:

   ```bash
   npm run worker:webhook
   ```

The API runs at `http://localhost:4000` by default.

Swagger UI is available at:

```text
http://localhost:4000/api/docs
```

For production-style migration execution, use:

```bash
npm run prisma:deploy
```

## Environment Variables

```env
DATABASE_URL=postgresql://taradi:taradi_local_password@localhost:5432/taradi?schema=public
JWT_SECRET=local-dev-jwt-secret-change-me-minimum-32-characters
JWT_EXPIRES_IN=7d
ADMIN_EMAIL=admin@taradiy.com
ADMIN_PASSWORD=123456789
PORT=4000
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=info
REDIS_URL=redis://localhost:6379
RATE_LIMIT_REDIS_ENABLED=true
RATE_LIMIT_REDIS_REQUIRED=false
RATE_LIMIT_REDIS_PREFIX=taradi:rate-limit
WEBHOOK_RATE_LIMIT_WINDOW_MS=60000
WEBHOOK_RATE_LIMIT_MAX=600
MESSAGE_RATE_LIMIT_WINDOW_MS=60000
MESSAGE_RATE_LIMIT_MAX=60
UPLOAD_RATE_LIMIT_WINDOW_MS=60000
UPLOAD_RATE_LIMIT_MAX=20
IMPORT_RATE_LIMIT_WINDOW_MS=3600000
IMPORT_RATE_LIMIT_MAX=5
CAMPAIGN_RATE_LIMIT_WINDOW_MS=600000
CAMPAIGN_RATE_LIMIT_MAX=10
TEMPLATE_SYNC_RATE_LIMIT_WINDOW_MS=600000
TEMPLATE_SYNC_RATE_LIMIT_MAX=5
WHATSAPP_QUEUE_CONCURRENCY=5
WEBHOOK_QUEUE_CONCURRENCY=5
WEBHOOK_QUEUE_ATTEMPTS=3
WEBHOOK_QUEUE_BACKOFF_MS=5000
UPLOAD_MAX_FILE_SIZE_MB=16
WHATSAPP_TOKEN=replace-with-whatsapp-cloud-api-token
SYSTEM_USER_TOKEN=replace-with-system-user-token-for-template-sync
WHATSAPP_ACCESS_TOKEN=replace-with-whatsapp-business-management-token
WHATSAPP_PHONE_NUMBER_ID=replace-with-phone-number-id
WHATSAPP_BUSINESS_ACCOUNT_ID=replace-with-business-account-id
WHATSAPP_VERIFY_TOKEN=taradi-local-webhook-verify-token
META_APP_SECRET=
VERIFY_META_SIGNATURE=false
META_GRAPH_API_VERSION=v23.0
META_API_VERSION=v25.0
```

In production, leave `RATE_LIMIT_REDIS_REQUIRED` unset or set it to `true`; startup fails if production is configured to use process-local rate limiting.

## Local Services

`docker-compose.yml` starts:

- PostgreSQL 16 Alpine on `localhost:5432`
- Redis 7 Alpine on `localhost:6379`

Both services use persistent named volumes and healthchecks. Redis powers BullMQ outbound WhatsApp jobs, inbound webhook jobs, and targeted rate limiting for sensitive operations. Login, auth checks, health checks, dashboard reads, search, and other normal API usage are not rate limited.

## Meta WhatsApp Setup

Use only official Meta WhatsApp Business Platform credentials:

- `WHATSAPP_PHONE_NUMBER_ID`: get it from Meta Developers > your app > WhatsApp > API Setup > From phone number. Use the numeric Phone Number ID, not the display phone number and not the WhatsApp Business Account ID.
- `WHATSAPP_BUSINESS_ACCOUNT_ID`: get it from WhatsApp Manager or Business Settings. This is the WABA ID and is only for WABA-level operations.
- `WHATSAPP_TOKEN`: token used by phone-number-scoped Cloud API calls such as sending messages and media operations.
- `WHATSAPP_ACCESS_TOKEN` or `SYSTEM_USER_TOKEN`: required management-capable token for template synchronization. It needs `whatsapp_business_management`; some Meta Business setups also require `business_management`.
- `META_GRAPH_API_VERSION`: Graph API version used for template sync and WhatsApp Cloud API calls. `META_API_VERSION` is still accepted as the existing equivalent name.

Required token permissions:

- `whatsapp_business_messaging`
- `whatsapp_business_management`

Phone-number-scoped Cloud API operations such as sending messages and uploading media use:

```text
/{WHATSAPP_PHONE_NUMBER_ID}/...
```

They must not use `WHATSAPP_BUSINESS_ACCOUNT_ID`.

Template synchronization uses the WABA endpoint:

```text
/{WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates
```

It must not use `WHATSAPP_PHONE_NUMBER_ID`.

If a send call returns:

```text
Unsupported post request. Object with ID '...' does not exist...
```

check that `WHATSAPP_PHONE_NUMBER_ID` is the Phone Number ID from API Setup, the token belongs to the same Business/App, and the token has the required WhatsApp permissions. The app logs Meta error code/message when `DEBUG=true`; it never logs raw access tokens.

## Runtime Processes

Run these as separate processes in development and production:

```bash
npm run dev
npm run worker:whatsapp
npm run worker:webhook
```

The API server handles HTTP, webhook verification/audit capture, auth, CRM data, Socket.IO notifications, and queueing outbound/inbound work. The outbound worker consumes message-send jobs, sends through WhatsApp Cloud API, and updates message status in PostgreSQL. The webhook worker consumes audited webhook events and dispatches inbound/status/template handlers outside the HTTP request path.

## Response Format

Successful JSON responses use:

```json
{
  "success": true,
  "data": {}
}
```

Error responses use:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": []
}
```

The WhatsApp webhook GET verification endpoint intentionally returns Meta's plain-text challenge instead of the JSON wrapper.

## Permissions

- System roles are `ADMIN`, `SUPERVISOR`, and `EMPLOYEE`.
- Admin has full access and is never restricted by dynamic permissions.
- Supervisor access is controlled by dynamic permissions and data scope. Supervisors can see customers/conversations assigned to themselves or direct-report employees when team view is enabled.
- Employee access is controlled by dynamic permissions and direct assignment scope. Employees can only see customers/conversations assigned directly to them.
- Inactive users cannot login or use old JWTs because protected requests reload the active user from the database.
- New inbound WhatsApp contacts are created as unassigned and visible only to admins until assignment.
- Dynamic role permissions are managed from `GET/PATCH /api/settings/permissions` for `SUPERVISOR` and `EMPLOYEE`.

## Conversation Engine

The inbox is backed by a `Conversation` row with one active conversation per customer for the MVP.

- `Conversation` stores assignment, status, priority, tags, last message metadata, archive state, and unread count.
- Customer assignment is mirrored to `Conversation.assignedEmployeeId`.
- Inbound WhatsApp messages create or update the conversation, increment `unreadCount`, set `status` to `OPEN`, and emit realtime updates.
- Outbound manual replies and bulk template sends create queued outbound messages, update the last message, and do not increment `unreadCount`.
- Customers with `collectionStatus=PAID` or `DO_NOT_CONTACT` return `contactBlocked=true`; manual sends are blocked, chat composer is locked, and bulk campaigns exclude them automatically.
- Media messages store metadata such as `mediaUrl`, `mediaId`, `mimeType`, `fileName`, `fileSize`, `caption`, and `duration` when available.
- `PATCH /api/chats/:customerId/read` clears `Conversation.unreadCount`.

## WhatsApp Media

Supported chat message types:

- Text
- Image
- Audio
- Voice note
- Document/file
- Template
- System

Local uploads are stored under `uploads/whatsapp` and served from `/uploads`. Uploaded file names are sanitized and replaced with generated storage names. The API rejects unsupported MIME types and files larger than `UPLOAD_MAX_FILE_SIZE_MB`.

Allowed MIME examples:

- `image/jpeg`
- `image/png`
- `image/webp`
- `audio/ogg`
- `audio/mpeg`
- `audio/mp4`
- `application/pdf`
- `application/msword`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

## Main Endpoints

Health:

- `GET /health`

Auth:

- `POST /api/auth/login`
- `GET /api/auth/me`

Team management:

- `GET /api/employees` admin sees supervisors/employees; supervisors see direct-report employees
- `POST /api/employees` admin only. Supervisors use email + password and have no employee code; employees use employee code + password
- `PATCH /api/employees/:id` admin only
- `PATCH /api/employees/:id/deactivate` admin only, disables login and API access for old tokens
- `PATCH /api/employees/:id/activate` admin only, restores login and API access
- `DELETE /api/employees/:id`

Settings:

- `GET /api/settings/permissions` admin only
- `PATCH /api/settings/permissions` admin only, updates sent permission keys for `SUPERVISOR` or `EMPLOYEE`

Customers:

- `GET /api/customers`
- `POST /api/customers`
- `POST /api/customers/import-csv` permission controlled, multipart body: `file` CSV up to 5MB
- `GET /api/customers/:id`
- `PATCH /api/customers/:id`
- `PATCH /api/customers/:id/collection-status` updates debt collection status and payment fields
- `DELETE /api/customers/:id` admin only
- `PATCH /api/customers/:id/assign` permission controlled, body: `{ "employeeId": "uuid-or-null" }`

Customer APIs return `collectionStatus`, `collectionStatusLabel`, computed `contactBlocked`, and the customer's primary and secondary phone numbers.

CSV customer import supports Arabic debt collection columns including customer identity, account, service, invoice status, collection status, payment fields, phones, and collector name. Example:

```csv
اسم العميل,رقم الهوية,رقم الحساب,الجهة,مبلغ المديونية,رقم الخدمة,حالة الفاتورة,حالة التحصيل,سنة المديونية,رقم الهاتف الرئيسي,كود الموظف
Ahmed Ali,123456789,ACC-1001,STC,2500,SVC-1001,غير مدفوعة,مديونية قائمة,2021,201000000000,EMP001
```

Conversation inbox and messages:

- `GET /api/chats`
- `GET /api/chats/:customerId/messages`
- `POST /api/chats/:customerId/messages` body: `{ "text": "Hello" }`, queues an outbound WhatsApp message
- `POST /api/chats/:customerId/messages/media` multipart body: `file`, `type`, optional `caption`
- `PATCH /api/chats/:customerId/read`
- `PATCH /api/chats/:customerId/status` body: `{ "status": "OPEN" | "PENDING" | "CLOSED" }`
- `PATCH /api/chats/:customerId/priority` body: `{ "priority": "LOW" | "NORMAL" | "HIGH" | "URGENT" }`
- `GET /api/inbox`
- `GET /api/customers/:id/messages`
- `POST /api/customers/:id/messages` body: `{ "text": "Hello" }`, queues an outbound WhatsApp message
- `POST /api/customers/:id/messages/read`

WhatsApp:

- `GET /api/whatsapp/webhook`
- `POST /api/whatsapp/webhook`
- `GET /api/whatsapp/templates` returns synced templates, approved by default
- `POST /api/whatsapp/templates/sync` syncs Meta templates, admin only
- `POST /api/whatsapp/messages/template` sends one approved template to a customer
- `POST /api/whatsapp/templates/bulk`

Bulk campaigns automatically exclude customers where `contactBlocked=true` and send to each eligible customer's primary phone.

Bulk template body:

```json
{
  "customerIds": ["customer-uuid"],
  "templateName": "hello_world",
  "languageCode": "en_US",
  "components": []
}
```

## Swagger API Docs

Open:

```text
http://localhost:4000/api/docs
```

To call protected endpoints from Swagger:

1. Run `POST /api/auth/login` with the seeded admin credentials from `.env`.
2. Copy the `data.token` value from the response.
3. Click `Authorize` in Swagger UI.
4. Paste the token as `Bearer <token>`.
5. Click `Authorize`, then call protected routes like employees, customers, inbox, messages, and campaigns.

The raw OpenAPI JSON is available at:

```text
http://localhost:4000/api/docs.json
```

## Socket.IO

Connect with the same JWT used for the REST API:

```js
io("http://localhost:4000", {
  auth: { token: "Bearer <jwt>" }
});
```

Events emitted by the backend:

- `socket:ready`
- `message:received`
- `message:sent`
- `message:status`
- `inbox:updated`

Admins receive all conversation events. Supervisors receive events for customers assigned to themselves or direct-report employees when the assigned user is available in the event payload. Employees receive events only for customers assigned to them.

## WhatsApp Cloud API Webhook

Configure Meta's webhook callback URL as:

```text
https://your-domain.com/api/whatsapp/webhook
```

Use `WHATSAPP_VERIFY_TOKEN` as the verify token in Meta App Dashboard.

Inbound message webhooks create or update customers by WhatsApp phone number, create or update the customer conversation, store the inbound message with `conversationId`, increment `Conversation.unreadCount`, and emit realtime events. Text, image, audio/voice, and document inbound messages are supported. When possible, inbound media is downloaded from WhatsApp Cloud API and saved locally with `mediaUrl`. Status webhooks update the matching outbound message by `whatsappMessageId`.

Outbound manual replies, media replies, and bulk template campaigns are stored as `QUEUED` messages first. Start `npm run worker:whatsapp` to process the Redis queue, upload media to WhatsApp when needed, send messages, and update statuses to `SENT` or `FAILED`.

## Testing Helpers

- Curl examples: [docs/API_TESTS.md](docs/API_TESTS.md)
- Postman setup: [docs/POSTMAN.md](docs/POSTMAN.md)
- Architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
