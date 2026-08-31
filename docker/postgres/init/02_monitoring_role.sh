#!/bin/bash
# Read-only server statistics for postgres_exporter. This role has no business
# table grants and never bypasses tenant RLS.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=database_name="$POSTGRES_DB" \
    --set=monitor_password="$DOKAN_MONITOR_PASSWORD" <<-'SQL'
    SELECT format(
        'CREATE ROLE dokan_monitor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L',
        :'monitor_password'
    )
    WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dokan_monitor') \gexec

    ALTER ROLE dokan_monitor NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
        PASSWORD :'monitor_password';
    GRANT pg_monitor TO dokan_monitor;
    GRANT CONNECT ON DATABASE :"database_name" TO dokan_monitor;
SQL

echo "Provisioned role: dokan_monitor (server statistics only)."
