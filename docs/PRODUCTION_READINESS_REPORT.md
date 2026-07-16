# Production Readiness Report

Report date: 2026-07-11

Status: READY WITH WARNINGS

## 1. Executive Summary

The project is closer to production after the security and performance passes: the critical frontend Graph API call was moved behind the backend, app JWTs are no longer attached to third-party absolute URLs, production env validation now blocks unsafe CORS/webhook settings, `/ready` was added, queue retry behavior was improved, inbound webhook processing was moved to BullMQ, Redis-backed rate limiting was added, frontend route bundles were split, and production runbooks were added.

The system should not be considered fully "go-live clean" until large import/campaign work is moved to dedicated persisted jobs, Socket.IO is made multi-instance aware, and critical auth/permission/webhook integration tests are expanded.

## 2. Critical Issues Fixed

- Frontend template listing no longer calls Meta Graph API directly.
- Axios no longer attaches the Taradi JWT to third-party absolute URLs.
- Production startup now rejects wildcard/empty CORS allowlists.
- Production startup now requires `VERIFY_META_SIGNATURE=true`.
- Production startup now requires `META_APP_SECRET` when signature verification is enabled.
- Development placeholder JWT secrets are rejected in production.
- New or changed employee passwords now require at least 8 characters.

## 3. Security Changes

- Added production-only env safety checks in `src/config/env.js`.
- Shared CORS allowlist parsing through `CORS_ORIGINS`.
- Applied CORS allowlist to both Express and Socket.IO.
- Kept Meta signature verification middleware and made unsafe production config fail fast.
- Prevented frontend auth header leakage to external absolute URLs.

## 4. Performance Changes

- Reduced duplicate React Query refetches after realtime inbound events.
- Realtime cache updates now insert conversations when the server sends a conversation payload for a conversation not already in the list.
- Outbound messages no longer increment unread counts in frontend cache updates.
- Moved inbound webhook dispatch out of the HTTP request path into `whatsapp-webhook-processing`.
- Added shared Redis-backed API rate limiting with local fallback for non-production environments.
- Added scoped high-cost limiters for message sends, media uploads, imports, bulk campaigns, and template sync.
- Added additive Prisma indexes for staff filters, customer pages, inbox recency filters, webhook auditing, and message status monitoring.
- Split frontend routes and vendor bundles so inbox/campaign/templates code is lazy-loaded.

## 5. Reliability Changes

- Added `GET /ready` with PostgreSQL and Redis/queue checks.
- Added `WHATSAPP_QUEUE_ATTEMPTS` env setting.
- Added `WEBHOOK_QUEUE_*` env settings and a dedicated webhook worker.
- BullMQ jobs now retry transient/network-like outbound failures.
- Webhook jobs now retry transient database/network-like processing failures.
- Permanent local/4xx outbound errors are still marked failed without wasting retries.
- Added PM2 ecosystem config for separate API, WhatsApp outbound worker, and webhook worker processes.

## 6. Database Migrations

Added:
- `prisma/migrations/20260711120000_add_performance_indexes/migration.sql`

The migration is additive only and creates targeted indexes for user role/active filters, customer assignment/status pagination, conversation status/date sorting, message status/date reporting, and webhook audit lookups. Details are in `docs/DATABASE_PERFORMANCE.md`.

## 7. API Changes

Added:
- `GET /ready`

No existing route was renamed or removed.

Changed:
- `POST /api/whatsapp/webhook` now returns after audit creation and job enqueueing instead of synchronous dispatch. The response includes `queued: true`, the audit event id, and the BullMQ job id.

## 8. Frontend Changes

- Template list API now uses `/api/whatsapp/templates`.
- Auth header attachment is scoped to the backend origin.
- Employee password validation matches backend minimum length.
- Socket cache behavior was adjusted to reduce redundant refetches.
- Main routes are now lazy-loaded with explicit vendor chunking.

## 9. Remaining Risks

- Inbound media downloads can still load full buffers into memory.
- Campaign send is bulk message enqueueing, not a persisted campaign workflow.
- Import parsing is memory-based and should move to a worker for large files.
- `xlsx` remains a dependency risk.
- Socket.IO presence/rooms are process-local without a Redis adapter.
- Test coverage remains below production-grade.

## 10. Known Meta Limitations

- Free-form text outside the 24-hour customer service window can fail with Meta re-engagement errors.
- Templates must be approved and active in Meta before sending.
- Media downloads depend on token validity and Meta URL lifetime.
- Webhook retries may deliver duplicate messages/statuses; message idempotency is required.

## 11. Manual Production Tests

Before go-live:

- Admin login by email.
- Supervisor login by email.
- Employee login by employee code.
- Inactive user cannot use an old token.
- Customer list scope for admin, supervisor, employee.
- Chat list scope for admin, supervisor, employee.
- Send text inside a valid WhatsApp window.
- Send approved template outside the 24-hour window.
- Inbound text webhook.
- Inbound image/PDF/audio webhook.
- Duplicate webhook delivery.
- Message status webhook.
- Template sync.
- Webhook worker shutdown/restart while Meta retries are active.
- Customer import dry run on a small sample.
- Employee import dry run on a small sample.
- `/health` returns 200.
- `/ready` returns 200.

## 12. Deployment Commands

Backend:

```bash
npm ci
npx prisma validate
npm run prisma:generate
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file "backups/predeploy-$(date +%Y%m%d-%H%M%S).dump"
npm run prisma:deploy
pm2 start ecosystem.config.cjs
pm2 save
```

Frontend:

```bash
cd frontend
npm ci
npm run typecheck
npm run build
rsync -az --delete dist/ /var/www/taradi-frontend/
```

Nginx requirements:
- Proxy `/api/` to backend.
- Proxy `/socket.io/` with WebSocket upgrade headers.
- Serve frontend static files with SPA fallback.
- Serve uploads through backend or a controlled static location with `nosniff`.
- Enable TLS and redirect HTTP to HTTPS.

WebSocket proxy headers:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

## 13. Rollback Commands

Application rollback:

```bash
pm2 stop taradi-api taradi-whatsapp-worker taradi-webhook-worker
git checkout <previous_release_sha>
npm ci
npm run prisma:generate
pm2 restart taradi-api taradi-whatsapp-worker taradi-webhook-worker --update-env
```

Database restore:

```bash
pm2 stop taradi-api taradi-whatsapp-worker taradi-webhook-worker
pg_restore --dbname "$DATABASE_URL" --clean --if-exists --no-owner --no-acl backups/predeploy-YYYYMMDD-HHMMSS.dump
pm2 start taradi-api taradi-whatsapp-worker taradi-webhook-worker
```

Frontend rollback:

```bash
cd frontend
git checkout <previous_release_sha>
npm ci
npm run build
rsync -az --delete dist/ /var/www/taradi-frontend/
```

## 14. Go-Live Recommendation

READY WITH WARNINGS

Reason:
- The most immediate critical bug and production config hazards were addressed.
- The app still needs stronger import/campaign architecture, multi-instance Socket.IO, media streaming, and broader automated tests before it should be treated as high-confidence production infrastructure.
