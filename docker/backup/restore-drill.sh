#!/bin/sh
set -eu

. /usr/local/bin/common.sh

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

BACKUP_DIR=${BACKUP_DIR:-/backups}
RESTORE_DATABASE=${RESTORE_DATABASE:-${PGDATABASE}_restore_drill}
KEEP_RESTORE_DATABASE=${KEEP_RESTORE_DATABASE:-false}

require_safe_directory "$BACKUP_DIR"
require_database_name "$PGDATABASE"
require_database_name "$RESTORE_DATABASE"
[ "$RESTORE_DATABASE" != "$PGDATABASE" ] || fail "restore database must differ from source"
case "$RESTORE_DATABASE" in
    *_restore_drill) ;;
    *) fail "restore database name must end with _restore_drill" ;;
esac

if [ "$#" -gt 0 ]; then
    case "$1" in
        /*) requested=$1 ;;
        *) requested="$BACKUP_DIR/$1" ;;
    esac
else
    requested=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' | sort | tail -n 1)
fi
[ -n "$requested" ] && [ -f "$requested" ] || fail "no logical backup found"

backup_root=$(readlink -f "$BACKUP_DIR")
dump=$(readlink -f "$requested")
case "$dump" in
    "$backup_root"/*.dump) ;;
    *) fail "restore input must be a .dump file inside $BACKUP_DIR" ;;
esac

if [ -f "$dump.sha256" ]; then
    (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$dump.sha256")" >/dev/null)
else
    fail "restore input checksum is missing"
fi

cleanup() {
    if [ "$KEEP_RESTORE_DATABASE" != "true" ]; then
        PGDATABASE=postgres dropdb --if-exists --force "$RESTORE_DATABASE" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT INT TERM

PGDATABASE=postgres dropdb --if-exists --force "$RESTORE_DATABASE"
PGDATABASE=postgres createdb "$RESTORE_DATABASE"
pg_restore --exit-on-error --no-owner --no-privileges \
    --dbname="$RESTORE_DATABASE" "$dump"

migrations=$(psql --dbname="$RESTORE_DATABASE" --no-align --tuples-only \
    --set=ON_ERROR_STOP=1 --command='SELECT count(*) FROM django_migrations;')
tables=$(psql --dbname="$RESTORE_DATABASE" --no-align --tuples-only \
    --set=ON_ERROR_STOP=1 \
    --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
case "$migrations:$tables" in
    0:*|*:0|*[!0-9:]*|:) fail "restored database failed schema smoke checks" ;;
esac

echo "Restore drill passed: $(basename "$dump") -> $RESTORE_DATABASE"
