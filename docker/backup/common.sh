#!/bin/sh

fail() {
    echo "backup error: $*" >&2
    exit 1
}

require_positive_integer() {
    value=$1
    label=$2
    case "$value" in
        ''|*[!0-9]*) fail "$label must be a positive integer" ;;
    esac
    [ "$value" -gt 0 ] || fail "$label must be greater than zero"
}

require_safe_directory() {
    path=$1
    case "$path" in
        /*) ;;
        *) fail "directory must be absolute: $path" ;;
    esac
    [ "$path" != "/" ] || fail "refusing to operate on /"
}

require_database_name() {
    name=$1
    case "$name" in
        ''|*[!A-Za-z0-9_]*) fail "unsafe database name: $name" ;;
    esac
    [ "${#name}" -le 63 ] || fail "database name exceeds PostgreSQL's 63-byte limit"
}

require_s3_uri() {
    case "$1" in
        s3://?*) ;;
        *) fail "BACKUP_S3_URI must start with s3://" ;;
    esac
}

aws_run() {
    if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
        aws --endpoint-url "$AWS_ENDPOINT_URL" "$@"
    else
        aws "$@"
    fi
}
