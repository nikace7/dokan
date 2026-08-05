# Deployment and Recovery Runbook

This runbook covers the Phase 1 single-VPS deployment described in
`SYSTEM_DESIGN.md` §8.8. PostgreSQL 16 is the compatibility boundary: do not
restore a physical base backup with a different PostgreSQL major version.

## Environments

| Environment | Purpose | Data | Recovery profile |
|---|---|---|---|
| `dev` | Local development | Demo/synthetic | `archive_mode=off` |
| `staging` | Release rehearsal | Anonymised production-like | Same backup settings as production |
| `prod` | Shop traffic | Customer data | Nightly dump + base backup + continuous WAL |

Staging and production use separate databases, Redis instances, object-storage
buckets, DNS records, secrets and SMS credentials. Never copy production PII to
development.

## Required configuration

Copy `.env.example` to `.env`, replace every `change-me` value, and keep the
file mode owner-only. Production additionally requires:

- `DJANGO_SETTINGS_MODULE=config.settings.prod`
- `ALLOWED_HOSTS`, `ROOT_DOMAIN`, `PLATFORM_ADMIN_ALLOWED_IPS`
- independent app, migrator and PostgreSQL passwords
- `POSTGRES_ARCHIVE_MODE=on`
- `BACKUP_S3_URI=s3://<private-bucket>/<environment>`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and the S3-compatible
  `AWS_ENDPOINT_URL` when the provider is not AWS
- a bucket lifecycle policy that retains logical dumps for at least 35 days,
  physical base backups for at least 35 days, and WAL for at least 35 days

The object-storage identity needs only list/get/put/delete access beneath the
configured bucket prefix. Enable bucket versioning and server-side encryption.

## First deployment

1. Point the apex and wildcard DNS records at the VPS. Keep the DNS TTL low for
   the first release.
2. Install Docker Engine with Compose v2 and a host firewall that exposes only
   SSH, HTTP and HTTPS. PostgreSQL and Redis are never public.
3. Place the repository and the externally supplied `.env` on the VPS.
4. Validate configuration without printing expanded secrets:

   ```bash
   docker compose --profile production config --quiet
   ```

5. Build and start the database and dependencies, then apply migrations with
   the dedicated migrator role:

   ```bash
   docker compose up -d db redis
   docker compose run --rm \
     -e DATABASE_USER=dokan_migrator \
     -e DATABASE_PASSWORD="$DOKAN_MIGRATOR_PASSWORD" \
     backend python manage.py migrate --noinput
   docker compose --profile production up -d --build
   ```

6. Provision the first platform administrator interactively with
   `create_platform_user`, enroll TOTP, and verify tenant and admin hosts.

The wildcard certificate needs a Caddy build containing the DNS provider
plugin. Supply its API token outside the repository and verify automatic renewal
in staging before production DNS is switched.

## Routine deployment

1. Confirm the target commit passed every required CI job.
2. Take an on-demand verified backup: `docker compose exec backup backup.sh`.
3. Pull the commit and rebuild images.
4. Run backward-compatible migrations with the migrator role.
5. Start/recreate services and inspect health checks.
6. Smoke-test login, item lookup, a held bill and a non-financial report on the
   staging host before promoting the same commit to production.

Migrations must be additive for one release. If application rollback is needed,
redeploy the previous image without reversing a migration unless that migration
has an explicitly tested reverse operation. Never restore the database merely
to roll back application code.

## Backup behavior

The `production` profile starts two recovery services:

- `backup` immediately creates a compressed custom-format `pg_dump`, verifies
  it with `pg_restore --list`, writes a SHA-256 file, uploads both, then repeats
  every 24 hours. It also creates a physical `pg_basebackup` at least weekly so
  archived WAL is usable for point-in-time recovery.
- `wal-uploader` sends completed WAL segments to object storage every minute.
  PostgreSQL forces an archive switch every five minutes by default. A WAL file
  is removed locally only after a successful sync and the local retention age.

The backup and WAL containers become unhealthy when their latest successful
work is stale. Alert on unhealthy status and object-storage write failures.
Local volumes are not a disaster-recovery copy; the remote bucket is required in
production.

## Monthly restore drill

Run this on the first day of every month and record the timestamp, source object,
duration and operator in the operations log:

```bash
docker compose --profile ops run --rm restore-drill
```

The command accepts an optional dump filename from the `backups` volume. It
verifies the checksum, restores into a database whose name must end with
`_restore_drill`, checks the migration/table schema, and removes that temporary
database. It refuses to target the source database.

At least quarterly, rehearse point-in-time recovery on an isolated host: download
the latest physical base archive and subsequent WAL objects, start the same
PostgreSQL major version with `recovery.signal` and a local `restore_command`,
recover to a chosen timestamp, and run the same application smoke checks. Never
perform a recovery rehearsal against the production data directory.

## Tenant export

An owner-requested portable export is separate from disaster recovery:

```bash
docker compose exec backend python manage.py export_tenant shop-slug \
  --output /tmp/shop-slug-export.zip
```

Copy the archive through an authenticated support channel, verify the recipient,
and remove the temporary copy after delivery. Password hashes are not exported.

## Monitoring and alerts

Production dashboards must include HTTP 5xx rate, `POST /sales` latency,
PostgreSQL connections/locks/disk, Redis memory, Celery queue age, container
health, logical-backup age, WAL-upload age and TLS expiry. Page when:

- 5xx exceeds 1%
- sales p95 exceeds one second
- database connections or disk exceed 80%
- backup/WAL health fails
- a monthly restore drill is overdue

Application logs must not contain tokens, PII or cost figures. Send errors to
Sentry and metrics to the configured Grafana/Postgres-exporter stack; monitor
every tenant health endpoint externally.

## Incident recovery

Preserve the failed host and remote backups before changing anything. Decide
whether the incident needs a logical restore (corruption discovered after a
known dump) or point-in-time recovery (host loss or a precise pre-incident
timestamp). Recover into an isolated replacement database, verify checksums,
schema, tenant counts, invoices and stock projections, then switch application
traffic. Document the recovery point objective actually achieved.
