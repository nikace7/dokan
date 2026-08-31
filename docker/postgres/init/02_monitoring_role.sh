#!/bin/bash
# Read-only server statistics for postgres_exporter. This role has no business
# table grants and never bypasses tenant RLS.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
    CREATE ROLE dokan_monitor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
        PASSWORD '${DOKAN_MONITOR_PASSWORD}';
    GRANT pg_monitor TO dokan_monitor;
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO dokan_monitor;
SQL

echo "Created role: dokan_monitor (server statistics only)."
