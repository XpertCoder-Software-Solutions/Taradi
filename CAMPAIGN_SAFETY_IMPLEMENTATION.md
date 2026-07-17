# Campaign Safety Implementation

## Purpose

The WhatsApp campaign path is isolated from normal agent replies. Agent replies continue through `whatsapp-outbound` and its independent reply limiter. Campaign recipients use `whatsapp-campaign-send`, database recipient state, bounded batches, per-phone serialization, and campaign-specific automatic pause rules.

These defaults are application safety controls. They are not advertised as Meta or WhatsApp sending limits and they do not bypass Meta restrictions.

## Architecture

1. The API validates an approved, active template and stores a campaign with its phone number and bounded rate settings.
2. `campaign-prepare.worker.js` pages through selected customers, resolves required variables, runs consent/suppression/frequency/phone checks, and stores every result as `PENDING` or `SKIPPED` in small transactions. It never sends or populates the normal outbound queue.
3. `campaign-send.worker.js` runs the recovery dispatcher on startup and periodically. A Redis `SET NX PX` lock prevents concurrent dispatch for one campaign. Only the oldest active campaign for a phone is dispatched.
4. The dispatcher leases one database batch and adds deterministic jobs to `whatsapp-campaign-send`. The ID is `campaign:{campaignId}:recipient-{recipientId}`. BullMQ rejects the four-colon-segment example in its custom ID validator, so the last separator is a hyphen while retaining the same deterministic identity.
5. The campaign worker uses the global BullMQ limiter, atomically claims one `QUEUED` recipient as `PROCESSING`, rechecks campaign pause/cancel state immediately before sending, and sends only the stored approved template payload.
6. The provider message ID, outbound message, recipient state, and customer frequency fields are committed together immediately after the provider response. A stranded `PROCESSING` row is deliberately not blindly resent after a crash because the provider may already have accepted it; it requires reconciliation, preventing an unsafe duplicate.
7. Webhook delivery/read/failure events update both `Message` and `CampaignRecipient` state.

## Statuses

Campaign statuses: `DRAFT`, `PREPARING`, `SCHEDULED`, `READY` (legacy-compatible), `QUEUED` (legacy-compatible), `RUNNING`, `PAUSED`, `COMPLETED`, `COMPLETED_WITH_ERRORS` (legacy-compatible), `FAILED`, and `CANCELLED`.

Recipient statuses: `PENDING`, `QUEUED`, `PROCESSING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `SKIPPED`, and `CANCELLED`.

The database is the source of truth. Queue jobs are only execution hints. Pause prevents further dispatch; already processing work finishes safely. Cancel marks pending/queued recipients cancelled and removes matching waiting/delayed jobs where possible.

## Eligibility and opt-out

Eligibility requires a normalized phone, opt-in when configured, no opt-out, no customer or global suppression, an active approved template, all template variables, an enabled local phone account, customer cooldown compliance, template cooldown compliance, and the rolling 30-day frequency cap. Duplicate customers in one campaign are stored as `SKIPPED`; no selected record is silently discarded.

Inbound Arabic and English opt-out phrases are normalized. Opt-out atomically records the inbound provider message ID, timestamp, reason, suppression state, and cancels pending/queued recipient rows. It also writes an audit record and publishes a realtime preference update. The implementation sends no automatic confirmation, which satisfies the policy requirement of at most one and avoids sending outside a confirmed service window.

Manual opt-in is admin-only and requires a source and timestamp. The actor comes from the authenticated admin and is recorded in the audit log.

## Rate and batch controls

Defaults:

- 20 campaign messages per 60 seconds.
- One campaign worker concurrency by default.
- 50 recipients per batch.
- Five minutes between batches.
- One active campaign per phone number.

Environment values are fallback defaults. An administrator can override campaign settings in `ApplicationSetting` through `/api/settings/campaign-safety`. Per-phone maximums and safety state are stored in `WhatsappPhoneNumber`. A campaign cannot exceed administrator maximums.

Normal replies retain `WHATSAPP_SEND_RATE_PER_SECOND` and are not processed by the campaign queue or campaign limiter.

## Error and retry rules

Errors are classified as `RETRYABLE`, `PERMANENT_RECIPIENT`, `PERMANENT_TEMPLATE`, `PERMANENT_ACCOUNT`, `AUTHENTICATION`, or `RATE_LIMIT`.

- Retryable and rate-limit failures use exponential backoff with jitter and provider retry timing when available.
- Permanent recipient failures are not retried.
- Permanent template failures pause the campaign.
- Authentication and permanent account failures pause every active campaign for the phone and create an admin alert.
- A rate-limit response never raises the configured send rate.

Automatic pause occurs when the configured sampled failure rate or consecutive-failure threshold is reached. Account, authentication, permission, restriction, and paused/disabled/rejected-template errors pause immediately.

## Phone safety state

Account states are `UNKNOWN`, `ACTIVE`, `RESTRICTED`, `DISABLED`, and `BANNED`. Quality states are `UNKNOWN`, `GREEN`, `YELLOW`, `RED`, and `LOW`.

Quality is synchronized only from supported incoming Meta webhook data. The application does not claim universal automatic quality access. Admins can securely update local phone state. Restricted, disabled, or banned accounts reject campaign start and pause existing campaigns.

## Audit coverage

`CampaignAuditLog` records campaign creation, preparation, start, pause, automatic pause, resume, cancellation, rate-setting changes, phone safety changes, customer opt-in/opt-out, and manual preference overrides with actor, campaign/customer, timestamp, old/new values, and reason where applicable.

## Deployment (no production data deletion)

Back up PostgreSQL using the existing operations procedure, then deploy with:

```bash
npm ci
npx prisma validate
npx prisma migrate deploy
npx prisma generate
npm test
npm --prefix frontend ci
npm --prefix frontend run build
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

Do not run `prisma migrate reset`, `prisma db push --force-reset`, or delete the database. The migration is additive and preserves legacy statuses and campaign data.

New or explicit PM2 worker commands:

```bash
pm2 start ecosystem.config.cjs --only taradi-campaign-prepare-worker
pm2 start ecosystem.config.cjs --only taradi-campaign-send-worker
pm2 restart taradi-campaign-prepare-worker taradi-campaign-send-worker --update-env
```

## Rollback

1. Pause active campaigns through the API or dashboard.
2. Stop `taradi-campaign-send-worker` and `taradi-campaign-prepare-worker`.
3. Roll back the application release and restart the API, reply worker, and webhook worker.
4. Retain the additive database columns, tables, and enum values. Older code ignores them, which is safer than destructive down-migration.
5. If a database rollback is required by policy, restore the pre-deployment backup into a separate database and validate it before switching traffic. Do not drop campaign safety tables from the live database while delivery webhooks may still arrive.

## Environment variables

See `.env.example` for the complete list. Campaign-specific variables are:

`CAMPAIGN_SEND_MAX`, `CAMPAIGN_SEND_DURATION_MS`, `CAMPAIGN_BATCH_SIZE`, `CAMPAIGN_BATCH_DELAY_MS`, `CAMPAIGN_MAX_ACTIVE_PER_PHONE`, `CAMPAIGN_SEND_CONCURRENCY`, `CAMPAIGN_SEND_ATTEMPTS`, `CAMPAIGN_DISPATCH_INTERVAL_MS`, `CAMPAIGN_DISPATCH_LOCK_MS`, `CAMPAIGN_REQUIRE_OPT_IN`, `CAMPAIGN_CUSTOMER_COOLDOWN_DAYS`, `CAMPAIGN_TEMPLATE_COOLDOWN_DAYS`, `CAMPAIGN_MAX_MESSAGES_PER_CUSTOMER_30_DAYS`, `CAMPAIGN_AUTO_PAUSE_MIN_SAMPLE`, `CAMPAIGN_AUTO_PAUSE_FAILURE_RATE_PERCENT`, `CAMPAIGN_AUTO_PAUSE_CONSECUTIVE_FAILURES`, `CAMPAIGN_AUTO_PAUSE_AUTH_ERRORS`, `CAMPAIGN_ADMIN_MAX_PER_MINUTE`, `CAMPAIGN_ADMIN_MAX_BATCH_SIZE`, and `CAMPAIGN_ADMIN_MIN_BATCH_DELAY_MS`.
