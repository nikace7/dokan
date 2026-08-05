#!/bin/sh
set -eu

. /usr/local/bin/common.sh

: "${BACKUP_S3_URI:?BACKUP_S3_URI is required for WAL upload}"

WAL_ARCHIVE_DIR=${WAL_ARCHIVE_DIR:-/wal-archive}
WAL_LOCAL_RETENTION_DAYS=${WAL_LOCAL_RETENTION_DAYS:-2}
WAL_UPLOAD_MARKER=${WAL_UPLOAD_MARKER:-/tmp/wal-upload.success}

require_safe_directory "$WAL_ARCHIVE_DIR"
require_positive_integer "$WAL_LOCAL_RETENTION_DAYS" WAL_LOCAL_RETENTION_DAYS
require_s3_uri "$BACKUP_S3_URI"
[ -d "$WAL_ARCHIVE_DIR" ] || fail "WAL archive directory does not exist"

aws_run s3 sync "$WAL_ARCHIVE_DIR/" "${BACKUP_S3_URI%/}/wal/" \
    --exclude '*.tmp' --only-show-errors
date +%s > "$WAL_UPLOAD_MARKER"

find "$WAL_ARCHIVE_DIR" -maxdepth 1 -type f -name '[0-9A-F]*' \
    -mtime "+$WAL_LOCAL_RETENTION_DAYS" -delete
