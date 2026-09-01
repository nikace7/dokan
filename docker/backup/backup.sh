#!/bin/sh
set -eu

. /usr/local/bin/common.sh

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
BASE_BACKUP_ENABLED=${BASE_BACKUP_ENABLED:-true}
BASE_BACKUP_INTERVAL_DAYS=${BASE_BACKUP_INTERVAL_DAYS:-7}
BASE_BACKUP_RETENTION_DAYS=${BASE_BACKUP_RETENTION_DAYS:-35}
REQUIRE_OBJECT_STORAGE=${REQUIRE_OBJECT_STORAGE:-true}

require_safe_directory "$BACKUP_DIR"
require_database_name "$PGDATABASE"
require_positive_integer "$BACKUP_RETENTION_DAYS" BACKUP_RETENTION_DAYS
require_positive_integer "$BASE_BACKUP_INTERVAL_DAYS" BASE_BACKUP_INTERVAL_DAYS
require_positive_integer "$BASE_BACKUP_RETENTION_DAYS" BASE_BACKUP_RETENTION_DAYS
mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || fail "another backup is already running"

if [ "$REQUIRE_OBJECT_STORAGE" = "true" ]; then
    : "${BACKUP_S3_URI:?BACKUP_S3_URI is required in production}"
fi
if [ -n "${BACKUP_S3_URI:-}" ]; then
    require_s3_uri "$BACKUP_S3_URI"
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump_final="$BACKUP_DIR/$PGDATABASE-$stamp.dump"
dump_temp="$BACKUP_DIR/.$PGDATABASE-$stamp.dump.tmp"
checksum_temp="$dump_final.sha256.tmp"
base_temp=""

cleanup() {
    rm -f -- "$dump_temp" "$checksum_temp"
    if [ -n "$base_temp" ] && [ -d "$base_temp" ]; then
        case "$base_temp" in
            "$BACKUP_DIR"/.base-*) rm -rf -- "$base_temp" ;;
            *) fail "refusing to remove unexpected temporary path: $base_temp" ;;
        esac
    fi
}
trap cleanup EXIT INT TERM

checksum() {
    file=$1
    temp="$file.sha256.tmp"
    (cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" > "$(basename "$temp")")
    mv "$temp" "$file.sha256"
}

upload() {
    category=$1
    file=$2
    [ -n "${BACKUP_S3_URI:-}" ] || return 0
    aws_run s3 cp "$file" "${BACKUP_S3_URI%/}/$category/$(basename "$file")" --only-show-errors
}

pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$dump_temp"
pg_restore --list "$dump_temp" >/dev/null
mv "$dump_temp" "$dump_final"
checksum "$dump_final"
upload logical "$dump_final"
upload logical "$dump_final.sha256"

if [ "$BASE_BACKUP_ENABLED" = "true" ]; then
    recent_base=$(find "$BACKUP_DIR" -maxdepth 1 -type f \
        -name "$PGDATABASE-*-base.tar.gz" -mtime "-$BASE_BACKUP_INTERVAL_DAYS" -print -quit)
    if [ -z "$recent_base" ]; then
        base_temp=$(mktemp -d "$BACKUP_DIR/.base-$stamp.XXXXXX")
        pg_basebackup --pgdata="$base_temp" --format=tar --gzip \
            --wal-method=stream --checkpoint=fast --no-password
        [ -f "$base_temp/base.tar.gz" ] || fail "pg_basebackup did not create base.tar.gz"
        for source in "$base_temp"/*.tar.gz; do
            tar -tzf "$source" >/dev/null
            target="$BACKUP_DIR/$PGDATABASE-$stamp-$(basename "$source")"
            mv "$source" "$target"
            checksum "$target"
            upload base "$target"
            upload base "$target.sha256"
        done
        rm -rf -- "$base_temp"
        base_temp=""
    fi
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name "$PGDATABASE-*.dump" -o -name "$PGDATABASE-*.dump.sha256" \) \
    -mtime "+$BACKUP_RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name "$PGDATABASE-*-base.tar.gz" -o -name "$PGDATABASE-*-base.tar.gz.sha256" \
       -o -name "$PGDATABASE-*-pg_wal.tar.gz" -o -name "$PGDATABASE-*-pg_wal.tar.gz.sha256" \) \
    -mtime "+$BASE_BACKUP_RETENTION_DAYS" -delete

completed_at=$(date +%s)
latest_base=$(find "$BACKUP_DIR" -maxdepth 1 -type f \
    -name "$PGDATABASE-*-base.tar.gz" | sort | tail -n 1)
base_completed_at=0
if [ -n "$latest_base" ]; then
    base_completed_at=$(stat -c %Y "$latest_base")
fi
write_metric_file dokan_backup.prom \
    '# HELP dokan_backup_last_success_timestamp_seconds Unix time of the last verified logical backup.' \
    '# TYPE dokan_backup_last_success_timestamp_seconds gauge' \
    "dokan_backup_last_success_timestamp_seconds $completed_at" \
    '# HELP dokan_base_backup_last_success_timestamp_seconds Unix time of the last verified physical base backup.' \
    '# TYPE dokan_base_backup_last_success_timestamp_seconds gauge' \
    "dokan_base_backup_last_success_timestamp_seconds $base_completed_at"

echo "Verified backup completed: $(basename "$dump_final")"
