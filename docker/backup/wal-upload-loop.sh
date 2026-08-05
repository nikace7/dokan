#!/bin/sh
set -eu

. /usr/local/bin/common.sh

WAL_UPLOAD_INTERVAL_SECONDS=${WAL_UPLOAD_INTERVAL_SECONDS:-60}
require_positive_integer "$WAL_UPLOAD_INTERVAL_SECONDS" WAL_UPLOAD_INTERVAL_SECONDS

while true; do
    /usr/local/bin/wal-upload.sh
    sleep "$WAL_UPLOAD_INTERVAL_SECONDS"
done
