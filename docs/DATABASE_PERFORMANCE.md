# Database Performance Notes

Report date: 2026-07-11

## Migration

Performance indexes were added in:

```text
prisma/migrations/20260711120000_add_performance_indexes/migration.sql
```

The migration is additive only. It creates indexes and does not drop tables, rewrite rows, or change column definitions.

## Index Map

| Table | New index | Main query path |
| --- | --- | --- |
| `User` | `role, isActive` | employee lists, active assignee lookups, import assignee resolution |
| `User` | `supervisorId, role, isActive` | supervisor team lists and active direct-report checks |
| `Customer` | `assignedToId, createdAt` | scoped customer pagination by assignee |
| `Customer` | `assignedToId, collectionStatus, createdAt` | assigned customer lists filtered by contact/collection state |
| `Customer` | `collectionStatus, createdAt` | admin collection-state lists and campaign exclusion checks |
| `CustomerPhone` | `customerId, isPrimary, position` | ordered phone includes for customer/chat cards |
| `Conversation` | `assignedEmployeeId, lastMessageAt` | inbox pages scoped to employee/team, sorted by recency |
| `Conversation` | `assignedEmployeeId, status, lastMessageAt` | inbox pages filtered by assignee and conversation status |
| `Conversation` | `status, lastMessageAt` | admin inbox status filters sorted by recency |
| `Message` | `status, statusUpdatedAt` | operational failed/queued message monitoring |
| `WebhookEvent` | `provider, eventType, createdAt` | webhook audit/event-type monitoring |
| `WebhookEvent` | `whatsappMessageId, status` | duplicate/status lookup and incident investigation |

## Query Behaviors Reviewed

- `listConversations` still uses offset pagination for page-number UX, but now has composite indexes for the common filters and sort order.
- `listMessages` already uses cursor pagination and existing `customerId, createdAt` / `conversationId, createdAt` indexes.
- `listCustomers` still supports page-number pagination and search filters; targeted composite indexes now cover the most common assigned/status/created paths.
- Employee and import assignee lookups now have role/active composite indexes.
- Webhook processing is now asynchronous, so webhook audit rows are written quickly and processed by a worker after the HTTP response.

## Rollout Guidance

Before deploying:

```bash
npx prisma validate
npm run prisma:generate
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file "backups/pre-index-$(date +%Y%m%d-%H%M%S).dump"
npm run prisma:deploy
```

After deploying, run `EXPLAIN (ANALYZE, BUFFERS)` on representative customer and inbox queries from production-like data. If write latency rises materially, re-check index usage before adding more indexes.

## Next Improvements

- Convert very deep customer and conversation page-number pagination to cursor pagination for large tenants.
- Add `pg_stat_statements` and capture slow query fingerprints before any further index additions.
- Consider trigram indexes for Arabic/name/phone search once production search volume is measured.
- Move large customer and employee imports to queue-backed jobs with streaming parsers.
