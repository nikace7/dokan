"""Postgres Row-Level Security helpers.

Two jobs:

1. ``rls_migration_operations(table)`` — the ``RunSQL`` operations a
   migration must include for every tenant-scoped table. Migrations run as
   the privileged migration role (``dokan_migrator``), which owns the tables;
   the app role (``dokan_app``) is a non-superuser, non-owner role that RLS
   constrains. ``FORCE ROW LEVEL SECURITY`` additionally binds the owner, so
   even a migration-role session cannot accidentally read across tenants.

2. ``set_local_tenant`` — runs the per-request
   ``SET LOCAL app.tenant_id = '<uuid>'`` (via ``set_config(..., true)``) that
   the ``tenant_isolation`` policy matches on. Called by
   ``core.middleware.tenant`` inside the request transaction. Safe with
   PgBouncer in *transaction* pooling mode; session mode would leak tenant
   context across requests and is forbidden.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
from uuid import UUID

from django.db import migrations

if TYPE_CHECKING:
    from django.db.backends.base.base import BaseDatabaseWrapper

_POLICY_NAME = "tenant_isolation"
_SETTING = "app.tenant_id"

_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def _validate_table_name(table: str) -> None:
    """Refuse anything that is not a plain SQL identifier (SQL injection guard)."""
    if not _IDENTIFIER.match(table):
        msg = f"Invalid table name for RLS operations: {table!r}"
        raise ValueError(msg)


def enable_rls_sql(table: str) -> str:
    """SQL enabling + forcing RLS and creating the tenant_isolation policy.

    ``NULLIF(..., '')``: after a transaction that used SET LOCAL rolls back,
    Postgres leaves a session-defined custom GUC at its boot value — the
    empty string, not NULL. ``''::uuid`` would raise instead of failing
    closed, so both NULL and '' must mean "no tenant context".
    """
    _validate_table_name(table)
    # Identifier is validated above, then quoted: "user" is a reserved word.
    predicate = f"NULLIF(current_setting('{_SETTING}', true), '')::uuid"
    return (
        f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY;\n'
        f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY;\n'
        f'CREATE POLICY {_POLICY_NAME} ON "{table}"\n'
        f"  USING      (tenant_id = {predicate})\n"
        f"  WITH CHECK (tenant_id = {predicate});"
    )


def disable_rls_sql(table: str) -> str:
    """Reverse of :func:`enable_rls_sql` (used as migrations' reverse_sql)."""
    _validate_table_name(table)
    return (
        f'DROP POLICY IF EXISTS {_POLICY_NAME} ON "{table}";\n'
        f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY;\n'
        f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY;'
    )


def rls_migration_operations(table: str) -> list[migrations.RunSQL]:
    """Return the migration operations to protect ``table`` with RLS.

    Usage in a migration for a tenant-scoped table::

        operations = [
            migrations.CreateModel(...),
            *rls_migration_operations("sales_invoice"),
        ]
    """
    return [migrations.RunSQL(sql=enable_rls_sql(table), reverse_sql=disable_rls_sql(table))]


def set_local_tenant(connection: BaseDatabaseWrapper, tenant_id: UUID | str) -> None:
    """Set ``app.tenant_id`` for the current transaction (``SET LOCAL``).

    Must be called inside an open transaction — the tenant middleware opens
    one around every tenant request. Parameterized, so no quoting risk.
    """
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config(%s, %s, true)", [_SETTING, str(tenant_id)])
