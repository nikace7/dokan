#!/bin/sh
set -eu

: "${DATABASE_NAME:?Set DATABASE_NAME}"
: "${DATABASE_USER:?Set DATABASE_USER}"
: "${DATABASE_PASSWORD:?Set DATABASE_PASSWORD}"
: "${PGBOUNCER_UPSTREAM_HOST:?Set PGBOUNCER_UPSTREAM_HOST}"

case "$DATABASE_NAME" in
  *[!A-Za-z0-9_]*) echo "DATABASE_NAME contains unsupported characters" >&2; exit 1 ;;
esac
case "$DATABASE_USER" in
  *[!A-Za-z0-9_]*) echo "DATABASE_USER contains unsupported characters" >&2; exit 1 ;;
esac
case "$PGBOUNCER_UPSTREAM_HOST" in
  *[!A-Za-z0-9_.-]*) echo "PGBOUNCER_UPSTREAM_HOST contains unsupported characters" >&2; exit 1 ;;
esac

max_clients=${PGBOUNCER_MAX_CLIENT_CONN:-500}
pool_size=${PGBOUNCER_DEFAULT_POOL_SIZE:-40}
reserve_size=${PGBOUNCER_RESERVE_POOL_SIZE:-10}
for value in "$max_clients" "$pool_size" "$reserve_size"; do
  case "$value" in
    ''|*[!0-9]*) echo "PgBouncer pool sizes must be integers" >&2; exit 1 ;;
  esac
done

if [ "$(printf '%s' "$DATABASE_PASSWORD" | wc -l)" -ne 0 ]; then
  echo "DATABASE_PASSWORD cannot contain a newline" >&2
  exit 1
fi
password_without_cr=$(printf '%s' "$DATABASE_PASSWORD" | tr -d '\r')
if [ "$password_without_cr" != "$DATABASE_PASSWORD" ]; then
  echo "DATABASE_PASSWORD cannot contain a carriage return" >&2
  exit 1
fi

# PgBouncer's auth-file format escapes a literal quote by doubling it. The
# generated file stays on the container's tmpfs and is never logged or mounted.
escaped_password=$(printf '%s' "$DATABASE_PASSWORD" | sed 's/"/""/g')
umask 077
printf '"%s" "%s"\n' "$DATABASE_USER" "$escaped_password" > /tmp/userlist.txt

{
  printf '[databases]\n'
  printf '%s = host=%s port=5432 dbname=%s\n\n' \
    "$DATABASE_NAME" "$PGBOUNCER_UPSTREAM_HOST" "$DATABASE_NAME"
  printf '[pgbouncer]\n'
  printf 'listen_addr = 0.0.0.0\n'
  printf 'listen_port = 6432\n'
  printf 'pool_mode = transaction\n'
  printf 'auth_type = scram-sha-256\n'
  printf 'auth_file = /tmp/userlist.txt\n'
  printf 'max_client_conn = %s\n' "$max_clients"
  printf 'default_pool_size = %s\n' "$pool_size"
  printf 'reserve_pool_size = %s\n' "$reserve_size"
  printf 'max_prepared_statements = 200\n'
  printf 'server_reset_query = DISCARD ALL\n'
  printf 'server_reset_query_always = 1\n'
  printf 'server_check_query = SELECT 1\n'
  printf 'server_check_delay = 30\n'
  printf 'server_idle_timeout = 600\n'
  printf 'query_wait_timeout = 120\n'
  printf 'pidfile = /tmp/pgbouncer.pid\n'
  printf 'unix_socket_dir = /tmp\n'
} > /tmp/pgbouncer.ini

exec /usr/bin/pgbouncer /tmp/pgbouncer.ini
