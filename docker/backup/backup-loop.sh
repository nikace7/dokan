#!/bin/sh
set -eu

. /usr/local/bin/common.sh

BACKUP_INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}
require_positive_integer "$BACKUP_INTERVAL_SECONDS" BACKUP_INTERVAL_SECONDS

while true; do
    /usr/local/bin/backup.sh
    sleep "$BACKUP_INTERVAL_SECONDS"
done
