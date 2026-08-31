#!/bin/sh
set -eu

project=${COMPOSE_PROJECT_NAME:-dokan-pgbouncer-test}
export DATABASE_HOST=pgbouncer
export DATABASE_PORT=6432
export DATABASE_POOL_MODE=transaction
# Git Bash otherwise rewrites container paths such as /tmp to Windows paths.
export MSYS_NO_PATHCONV=1

cleanup() {
  docker compose -p "$project" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -p "$project" up -d --wait db pgbouncer

for setting in \
  'pool_mode = transaction' \
  'auth_type = scram-sha-256' \
  'server_reset_query_always = 1'; do
  docker compose -p "$project" exec -T pgbouncer \
    grep -qx "$setting" /tmp/pgbouncer.ini
done
test "$(docker compose -p "$project" exec -T pgbouncer stat -c '%a' /tmp/userlist.txt)" = "600"

cleared=$(
  docker compose -p "$project" exec -T pgbouncer sh -c \
    'PGPASSWORD="$DATABASE_PASSWORD" psql -qAt -h 127.0.0.1 -p 6432 \
      -U "$DATABASE_USER" -d "$DATABASE_NAME" -v ON_ERROR_STOP=1' <<'SQL' | tail -n 1
BEGIN;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';
COMMIT;
SELECT COALESCE(NULLIF(current_setting('app.tenant_id', true), ''), 'cleared');
SQL
)
test "$cleared" = "cleared"

echo "PgBouncer transaction-pooling contract passed."
