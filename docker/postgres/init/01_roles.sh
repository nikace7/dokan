#!/bin/bash
# Creates the application database roles (ARCHITECTURE §6 invariant 5):
#
#   dokan_migrator — owns the schema, runs migrations, bypasses RLS as owner
#                    of the tables (FORCE RLS still applies; migrations use
#                    SET ROLE / explicit tenant context when backfilling).
#   dokan_app      — the application role: LOGIN, non-superuser, non-owner,
#                    NOBYPASSRLS. Every tenant-scoped table is protected by a
#                    tenant_isolation policy (see backend/core/db/rls.py).
#
# Runs once on first container start (docker-entrypoint-initdb.d).
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
    CREATE ROLE dokan_migrator LOGIN PASSWORD '${DOKAN_MIGRATOR_PASSWORD}';
    CREATE ROLE dokan_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
        PASSWORD '${DOKAN_APP_PASSWORD}';

    ALTER DATABASE ${POSTGRES_DB} OWNER TO dokan_migrator;

    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO dokan_app;
    GRANT USAGE ON SCHEMA public TO dokan_app;

    -- Every table the migrator creates is DML-able by the app role...
    ALTER DEFAULT PRIVILEGES FOR ROLE dokan_migrator IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dokan_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE dokan_migrator IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO dokan_app;

    -- ...except the audit log, which is append-only (ARCHITECTURE §6 invariant 7).
    -- A migration revokes UPDATE/DELETE on audit_log once that table exists:
    --   REVOKE UPDATE, DELETE ON audit_log FROM dokan_app;
SQL

echo "Created roles: dokan_migrator (owner), dokan_app (RLS-constrained app role)."
