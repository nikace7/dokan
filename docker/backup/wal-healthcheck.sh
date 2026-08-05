#!/bin/sh
set -eu

. /usr/local/bin/common.sh

WAL_UPLOAD_MARKER=${WAL_UPLOAD_MARKER:-/tmp/wal-upload.success}
WAL_UPLOAD_MAX_AGE_SECONDS=${WAL_UPLOAD_MAX_AGE_SECONDS:-180}
require_positive_integer "$WAL_UPLOAD_MAX_AGE_SECONDS" WAL_UPLOAD_MAX_AGE_SECONDS
[ -f "$WAL_UPLOAD_MARKER" ] || fail "WAL upload has not completed"

last=$(cat "$WAL_UPLOAD_MARKER")
require_positive_integer "$last" WAL_UPLOAD_MARKER
age=$(( $(date +%s) - last ))
[ "$age" -le "$WAL_UPLOAD_MAX_AGE_SECONDS" ] || fail "WAL upload is stale"
