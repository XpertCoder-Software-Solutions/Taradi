# Backup and Rollback Runbook

## Principles

- Never run `prisma migrate reset` against production.
- Always take a database backup before applying migrations.
- Prisma migrations in this project should be treated as forward-only in production.
- If a migration has already been applied in production, prefer a forward-fix migration unless restoring a backup is explicitly approved.

## Database Backup

Set the production database URL without printing it to logs:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DB?schema=public'
```

Create a compressed custom-format backup:

```bash
mkdir -p backups
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file "backups/taradi-$(date +%Y%m%d-%H%M%S).dump"
```

Optional plain SQL backup:

```bash
pg_dump "$DATABASE_URL" --no-owner --no-acl --file "backups/taradi-$(date +%Y%m%d-%H%M%S).sql"
```

Verify backup metadata:

```bash
pg_restore --list backups/taradi-YYYYMMDD-HHMMSS.dump | head
```

## Migration Deployment

Before deploy:

```bash
npm ci
npx prisma validate
npm run prisma:generate
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file "backups/predeploy-$(date +%Y%m%d-%H%M%S).dump"
npm run prisma:deploy
```

Do not run:

```bash
npx prisma migrate reset
```

## Restore Procedure

Restoring is destructive to the target database. Stop app and worker first:

```bash
pm2 stop taradi-api taradi-whatsapp-worker
```

Restore into an empty replacement database when possible:

```bash
createdb taradi_restore
pg_restore --dbname "postgresql://USER:PASSWORD@HOST:5432/taradi_restore" --clean --if-exists --no-owner --no-acl backups/taradi-YYYYMMDD-HHMMSS.dump
```

Point the app to the restored database, then start services:

```bash
pm2 start ecosystem.config.cjs --only taradi-api
pm2 start ecosystem.config.cjs --only taradi-whatsapp-worker
pm2 save
```

If restoring into the same database is approved:

```bash
pm2 stop taradi-api taradi-whatsapp-worker
pg_restore --dbname "$DATABASE_URL" --clean --if-exists --no-owner --no-acl backups/taradi-YYYYMMDD-HHMMSS.dump
pm2 start taradi-api taradi-whatsapp-worker
```

## Application Rollback

Backend code rollback:

```bash
git fetch --all
git checkout <previous_release_sha>
npm ci
npm run prisma:generate
pm2 restart taradi-api taradi-whatsapp-worker --update-env
```

Frontend rollback:

```bash
cd frontend
git checkout <previous_release_sha>
npm ci
npm run build
rsync -az --delete dist/ /var/www/taradi-frontend/
```

If the previous backend cannot run against the current database schema, do not force rollback code alone. Use forward-fix or restore the predeploy database backup.

## Worker Rollback

Stop workers before rolling back code if outbound message behavior changed:

```bash
pm2 stop taradi-whatsapp-worker
git checkout <previous_release_sha>
npm ci
npm run prisma:generate
pm2 restart taradi-whatsapp-worker --update-env
```

Check pending/failed jobs after worker restart.

## Post-Restore Checks

```bash
curl -fsS https://waapi.taradiy.com/health
curl -fsS https://waapi.taradiy.com/ready
pm2 status
pm2 logs taradi-api --lines 100
pm2 logs taradi-whatsapp-worker --lines 100
```

Manual smoke tests:
- Admin login.
- Employee login.
- Customer list loads.
- Inbox loads.
- Send a test message to an approved test recipient.
- Receive a webhook from Meta test message.
- Template list loads from backend.
