# Taradi WhatsApp CRM Technical Audit

Audit date: 2026-07-11

Scope inspected:
- Backend: Express app/server, env/config, auth/permissions, routes, controllers, services, webhook dispatcher, WhatsApp integration, BullMQ worker/queue, Socket.IO, media handling, Prisma schema/migrations, logging, Docker Compose, tests.
- Frontend: Vite/React app, API clients, auth context, Socket.IO provider, React Query usage, inbox/customers/employees/templates pages, RTL UI patterns, build/test configuration.

This report is based on source inspection and local command output. It avoids destructive database actions; no migration reset was run.

## Executive Summary

The project has a solid MVP foundation: centralized JWT auth, role/permission checks on most protected routes, Prisma schema constraints, paginated list endpoints, Arabic RTL frontend, structured logging, webhook audit records, and idempotent outbound queue job IDs.

The main production blockers are not broad architecture rewrites; they are specific reliability and security gaps:

1. Production configuration still allows unsafe values unless operators configure them correctly, especially wildcard CORS and optional Meta signature verification.
2. WhatsApp webhook processing is synchronous and can perform media downloads before responding to Meta, increasing retry and timeout risk.
3. The frontend template list client calls Graph API directly instead of the backend proxy, which can break CORS and leak the app JWT to an external origin.
4. Socket realtime updates are followed by broad React Query invalidations, causing duplicate API traffic after inbound events.
5. Queue retry policy is effectively disabled (`attempts: 1`), so transient Meta/network failures become permanent immediately.
6. Import endpoints load files fully in memory and trust extension more than content signature for CSV/Excel.
7. Automated test coverage is currently very narrow.

## Critical Bugs

- `frontend/src/api/templates.api.ts` calls `https://graph.facebook.com/.../message_templates` directly from the browser. The Axios interceptor attaches the application JWT to every request, including absolute third-party URLs. Impact: template listing likely fails in browsers and the app token can be sent to Meta as an invalid `Authorization` header.
- Production env validation does not reject `CORS_ORIGIN="*"` or `VERIFY_META_SIGNATURE=false`. Impact: an operator can accidentally deploy with wildcard browser access and unverified webhooks.
- Login password policy accepts 6-character employee passwords in backend create/update schemas. Impact: weak credentials for production accounts.

## High-Risk Bugs

- Webhook POST handling stores the audit event and dispatches all processing synchronously before responding. Inbound media downloads happen inside this path. Impact: Meta webhook retries can occur under slow media/network conditions; duplicate delivery pressure rises.
- `dispatchWebhook` catches handler errors, marks the audit event `FAILED`, and still returns a successful HTTP response via `res.success`. Impact: Meta may not retry failed processing even when the event failed internally.
- BullMQ outbound queue default `attempts` is `1`. Impact: transient Meta/network/Redis failures are not retried by the queue.
- `whatsapp.downloadMedia` uses `maxContentLength: Infinity` and returns a full buffer. Impact: large media can increase memory pressure.
- Import endpoints use Multer memory storage and row-by-row DB work. Impact: large imports can block the request and generate many queries.
- Frontend socket event handlers both patch React Query caches and then invalidate broad keys. Impact: one inbound message can cause multiple duplicate refetches and UI churn.
- `message.service.sendBulkTemplate` enqueues up to 500 recipients synchronously in one API request. Impact: slow campaign creation and partial failure complexity.

## Medium-Risk Bugs

- `conversation.service.listConversationMessages` orders ascending while using a cursor, which is awkward for "load older" pagination and can skip the expected previous slice.
- Template listing backend has no pagination; all matching templates are returned.
- `notifications.api.ts` derives unread summary from `listChats({ limit: 100, unreadOnly: true })`; unread totals can be wrong above 100 unread conversations.
- `User.role`, `User.employeeCode`, `User.isActive`, `Conversation.status + lastMessageAt`, and several filter combinations could use more targeted indexes.
- Rate limiting uses in-memory `express-rate-limit`; it is not shared across multiple API instances.
- Socket.IO has no Redis adapter; multi-instance deployments will not share rooms/presence.
- Health endpoint is basic only; no `/ready` endpoint currently checks PostgreSQL, Redis, queue state, or critical config.
- Error responses expose raw Prisma unique metadata in generic `P2002` cases.
- Upload validation checks allowed MIME from client metadata for media and extension only for imports; no content sniffing/signature check.
- `xlsx` remains a known dependency risk area; there is no documented mitigation or alternative plan.

## Low-Risk Issues

- Some debug logs include message text and webhook snapshots when `DEBUG=true`; safe for local troubleshooting but should stay off in production.
- Frontend stores JWT in `localStorage`, increasing XSS blast radius compared with httpOnly cookies.
- `frontend/.env.example` is deleted in the current worktree, so frontend env onboarding is incomplete.
- PM2, Nginx, backup/rollback, and production deployment docs are missing.
- `prisma/seed.js` uses console logging instead of project logger.
- There are duplicate legacy routes for messages via `/api/customers/:id/messages`, `/api/chats/:customerId/messages`, and `/api/messages/:id/download-media`; they appear intentional for compatibility but should be documented.

## Security Vulnerabilities

- Browser API client can attach JWT to absolute third-party URLs.
- Production does not enforce a concrete CORS allowlist.
- Production does not enforce Meta signature verification.
- Weak password minimum for employee/admin-created accounts.
- Import file validation is extension-based.
- Uploaded media is served from Express static with cache/security headers, but there is no explicit executable extension denylist because names are generated from MIME-derived or sanitized original extensions.
- Raw Meta payloads and message raw payloads are stored; access to these fields should be limited or stripped from ordinary API responses where not needed.

## Authorization and IDOR Review

Confirmed protections:
- `authenticate` rejects inactive/deactivated users on every authenticated request.
- Customer access is centralized through `customerAccessWhere` and `getCustomerForUser`.
- Conversation access is centralized through `conversationAccessWhere` and `getConversationForUserByCustomerId`.
- Supervisors are scoped to their own user id plus direct reports; employees are scoped to their own assignments.
- Assignment uses `assertAssignableStaff`.

Risks:
- Admin-only operations are protected, but some routes rely on custom inline admin checks rather than a shared middleware.
- Campaign/template bulk send shares message service behavior but has no persistent campaign recipient model or per-recipient scope audit.
- Direct raw payload exposure should be audited in response formatting for ordinary users.

## Performance Bottlenecks

- Customer import performs per-row supervisor/employee/customer lookups and create/update operations.
- Employee import performs per-row supervisor creation/lookup and bcrypt hashing inside the request.
- Webhook media download blocks webhook processing.
- Unread count notification emits aggregate queries after inbound messages.
- Frontend socket handlers broadly invalidate `chats`, `notifications`, and `messages` after already patching the cache.
- Customers and chats search use `contains`/case-insensitive filters that can become slow without normalized searchable columns or trigram indexes.

## N+1 Database Query Risks

- Customer import and employee import are row-by-row.
- `findCustomerByPhone` may run multiple fallback queries and suffix searches per inbound message.
- `emitUnreadCountNotifications` queries direct reports for each relevant inbound event.
- Supervisor assigned customer counts use an extra direct report lookup; acceptable for pages, but not for high-frequency paths.

## Duplicate API Requests and React Renders

- `SocketProvider` cache patches are followed by invalidations for the same query families.
- Inbox page mutation success handlers invalidate broad keys immediately after socket events may do the same.
- Search boxes in inbox/customers/templates fire queries on every keystroke without debounce.
- Query keys include object literals, which React Query handles structurally, but lack debounced state.

## Memory Leaks and Socket Listener Leaks

Confirmed:
- `SocketProvider` removes listeners on cleanup.
- `socketManager.disconnectSocket` removes all listeners on token changes/logout.
- Presence tracks multiple tabs and clears offline timers.

Risks:
- Media downloads and upload/import parsing use full buffers.
- Socket presence is process-local and will not survive multi-instance deployment without Redis adapter.

## Queue Reliability Issues

- Outbound queue uses idempotent `jobId: message-${messageId}`.
- Queue attempts are set to `1`; backoff exists but is ineffective.
- Worker returns `{ status: "FAILED" }` without throwing for failed sends, so BullMQ treats permanent and transient send failures as completed jobs.
- No dead-letter queue or failed-job operational guide.
- No campaign queue or chunked recipient processing exists.

## Missing Indexes

Already present:
- Customer assignment/filter fields, CustomerPhone phone/customer, Message customer/conversation/whatsapp id, Conversation assignment/status/lastMessageAt, RolePermission uniqueness.

Recommended safe additions:
- `User.role`, `User.employeeCode`, `User.isActive`, and possibly `[role, isActive]`.
- `Conversation.status, lastMessageAt`.
- `Message.createdAt`, `Message.direction, createdAt`, `Message.status, statusUpdatedAt`.
- `WebhookEvent.whatsappMessageId, status`.
- Consider trigram/GIN indexes for text search later through SQL migrations if PostgreSQL extension policy allows it.

## Missing Validation

- Production-only env invariants for CORS and Meta signature.
- Stronger password policy.
- File content signature validation for Excel/PDF/images/video/audio where practical.
- Pagination schema validation for every list endpoint, rather than ad hoc numeric parsing.
- Date and decimal validation exists in customer service but should be centralized for consistency.

## Inconsistent Response Formats

- Most APIs use `{ success, data }`.
- Rate-limit errors use `{ success, message, errors }` directly.
- Error middleware has custom Prisma branches with different messages and raw metadata.
- Some frontend API clients normalize legacy response shapes, especially employees.

## Missing Tests

Current automated tests:
- `test/webhookParser.test.js` covers inbound content/media parsing.

Missing high-value tests:
- Auth login role restrictions and inactive user rejection.
- Permission/IDOR tests for customer/chat access.
- Customer import duplicate handling.
- Paid/do-not-contact send blocking.
- Template payload builder and approved-template enforcement.
- Webhook idempotency and duplicate inbound message handling.
- Queue transient/permanent error handling.
- Frontend socket event deduplication and template API client behavior.

## Production Blockers

- Unsafe production config not rejected.
- Frontend Graph API direct call.
- No `/ready` endpoint.
- Webhook processing is not decoupled from request acknowledgment.
- Queue retry/dead-letter strategy is incomplete.
- Production deployment docs and backup/rollback docs are missing.
- Test coverage is not sufficient for go-live.

## Safe Fixes Selected for This Pass

The following changes are safe, backward-compatible, and directly tied to critical/high findings:

1. Change frontend template listing to use `/api/whatsapp/templates`.
2. Prevent Axios from attaching the app JWT to absolute third-party URLs.
3. Add production-only env validation for wildcard CORS and Meta signature settings.
4. Add `/ready` with PostgreSQL and Redis checks.
5. Increase queue attempts for transient retry potential while preserving message idempotency.
6. Reduce socket-driven duplicate refetches where cache patching already provides the update.
7. Add documentation for observability, dependency risk, backup/rollback, and production readiness.

Larger items intentionally left as follow-up:
- Async webhook queue architecture.
- Redis-backed rate limiting.
- Campaign persistence and chunked campaign queue.
- Import worker pipeline.
- Multi-instance Socket.IO Redis adapter.
- Full test suite expansion.
