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
completed_at=$(date +%s)
printf '%s\n' "$completed_at" > "$WAL_UPLOAD_MARKER"
write_metric_file dokan_wal.prom \
    '# HELP dokan_wal_upload_last_success_timestamp_seconds Unix time of the last successful WAL upload.' \
    '# TYPE dokan_wal_upload_last_success_timestamp_seconds gauge' \
    "dokan_wal_upload_last_success_timestamp_seconds $completed_at"

find "$WAL_ARCHIVE_DIR" -maxdepth 1 -type f -name '[0-9A-F]*' \
    -mtime "+$WAL_LOCAL_RETENTION_DAYS" -delete
