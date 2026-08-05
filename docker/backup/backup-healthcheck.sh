#!/bin/sh
set -eu

. /usr/local/bin/common.sh

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_MAX_AGE_MINUTES=${BACKUP_MAX_AGE_MINUTES:-1560}
BASE_BACKUP_ENABLED=${BASE_BACKUP_ENABLED:-true}
BASE_BACKUP_MAX_AGE_MINUTES=${BASE_BACKUP_MAX_AGE_MINUTES:-11520}

require_safe_directory "$BACKUP_DIR"
require_positive_integer "$BACKUP_MAX_AGE_MINUTES" BACKUP_MAX_AGE_MINUTES
require_positive_integer "$BASE_BACKUP_MAX_AGE_MINUTES" BASE_BACKUP_MAX_AGE_MINUTES

latest=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' \
    -mmin "-$BACKUP_MAX_AGE_MINUTES" | sort | tail -n 1)
[ -n "$latest" ] || fail "no recent logical backup"
[ -f "$latest.sha256" ] || fail "logical backup checksum is missing"
(cd "$BACKUP_DIR" && sha256sum -c "$(basename "$latest.sha256")" >/dev/null)
pg_restore --list "$latest" >/dev/null

if [ "$BASE_BACKUP_ENABLED" = "true" ]; then
    base=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*-base.tar.gz' \
        -mmin "-$BASE_BACKUP_MAX_AGE_MINUTES" | sort | tail -n 1)
    [ -n "$base" ] || fail "no recent physical base backup"
    [ -f "$base.sha256" ] || fail "base backup checksum is missing"
    (cd "$BACKUP_DIR" && sha256sum -c "$(basename "$base.sha256")" >/dev/null)
    tar -tzf "$base" >/dev/null
fi
