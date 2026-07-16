# Performance And Scalability Report

Report date: 2026-07-11

Status: IMPROVED, READY WITH REMAINING SCALE RISKS

## Executive Summary

This pass moved the highest-risk request-path work out of synchronous HTTP handling, added Redis-backed rate limiting for multi-process deployments, added targeted database indexes for the busiest query paths, split the frontend route bundles, and expanded focused backend tests.

The system is materially safer under load than before this pass. The remaining major scale risks are large import parsing, non-persisted campaign orchestration, process-local Socket.IO state, and buffered inbound media downloads.

## Changes Shipped

### Async WhatsApp Webhooks

- Added `whatsapp-webhook-processing` BullMQ queue.
- Added `src/queues/webhook.queue.js` producer.
- Added `src/workers/whatsapp-webhook.worker.js` consumer.
- Changed `POST /api/whatsapp/webhook` to create a `WebhookEvent`, enqueue the job, and return quickly with `queued: true`.
- Added retry classification for transient database/network failures in `src/services/webhookProcessor.service.js`.
- Added `WEBHOOK_QUEUE_CONCURRENCY`, `WEBHOOK_QUEUE_ATTEMPTS`, and `WEBHOOK_QUEUE_BACKOFF_MS`.
- Added `npm run worker:webhook` and PM2 process `taradi-webhook-worker`.
- Updated `/ready` to report both outbound and webhook queue readiness.

### Rate Limiting

- Replaced process-local `express-rate-limit` usage with a Redis-first limiter in `src/middleware/rateLimit.middleware.js`.
- Kept a memory fallback for development/test only; production now fails startup if Redis-backed limiting is disabled or explicitly non-required.
- Added named policies for:
  - general API traffic
  - auth
  - Meta webhooks
  - message sends
  - media uploads
  - imports
  - bulk campaign/template sends
  - template sync
- Applied high-cost policies before file parsing or queue-producing work.

### Database

- Added additive migration `20260711120000_add_performance_indexes`.
- Indexed hot paths for employee filters, assigned customer pages, conversation recency filters, webhook audit lookups, message status monitoring, and primary phone ordering.
- Added detailed query/index notes in `docs/DATABASE_PERFORMANCE.md`.

### Frontend

- Converted app pages/layout to route-level `React.lazy`.
- Added Vite `manualChunks` for React, query, realtime, icons, HTTP, forms, alerts, and emoji picker dependencies.
- Removed the previous large single entry chunk warning. The largest current JS chunk is isolated `vendor-emoji` at `304.45 kB` minified / `73.17 kB` gzip.

## Validation Results

| Check | Result |
| --- | --- |
| `npx prisma validate` | Passed |
| `npm run prisma:generate` | Passed |
| `npm test` | Passed, 12 tests |
| `find src test -name '*.js' -exec node --check {} \\;` | Passed |
| `docker compose config` | Passed |
| `cd frontend && npm run typecheck` | Passed |
| `cd frontend && npm run build` | Passed |
| Backend `npm audit --audit-level=moderate` | 1 high advisory: `xlsx`, no fix available |
| Frontend `npm audit --audit-level=moderate` | 0 vulnerabilities |

## Bundle Snapshot

After route splitting:

- app entry: `26.26 kB` minified / `9.58 kB` gzip
- `vendor-react`: `157.74 kB` / `51.04 kB` gzip
- `vendor-emoji`: `304.45 kB` / `73.17 kB` gzip
- `InboxPage`: `45.52 kB` / `13.22 kB` gzip
- `CustomersPage`: `35.81 kB` / `9.43 kB` gzip
- `CampaignsPage`: `8.69 kB` / `3.23 kB` gzip

## Remaining Scale Risks

- Customer and employee imports still parse uploaded work in the API process. Next step: persisted import jobs plus streaming parsers.
- Bulk campaign sends still create outbound work from the request path rather than a campaign table/job lifecycle with pause/resume/reporting.
- Socket.IO rooms, presence, and realtime fanout are still process-local. Next step: Redis adapter and shared presence state.
- Inbound media download can still buffer full files in memory. Next step: stream Meta media downloads to disk/object storage.
- `xlsx` remains a backend dependency risk with no current npm audit fix. Next step: isolate parsing in workers and evaluate a safer parser for required file formats.
- Search uses `contains` filters. Next step after real query telemetry: `pg_stat_statements`, slow query review, and possibly trigram indexes.

## Recommended Next Phase

1. Add persisted `ImportJob` and `CampaignJob` models with queue workers, status APIs, and admin progress views.
2. Add Socket.IO Redis adapter before running more than one API instance.
3. Add webhook controller integration tests with mocked BullMQ/Prisma.
4. Add `pg_stat_statements` and slow-query dashboards before adding more indexes.
