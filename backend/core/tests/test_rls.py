"""Tests for core/db/rls.py — policy SQL generation (no database needed)."""

import pytest
from django.db import migrations

from core.db.rls import (
    disable_rls_sql,
    enable_rls_sql,
    grant_update_delete_sql,
    revoke_update_delete_operation,
    revoke_update_delete_sql,
    rls_migration_operations,
)


def test_enable_rls_sql_matches_design() -> None:
    sql = enable_rls_sql("sales_invoice")
    assert 'ALTER TABLE "sales_invoice" ENABLE ROW LEVEL SECURITY;' in sql
    assert 'ALTER TABLE "sales_invoice" FORCE ROW LEVEL SECURITY;' in sql
    assert 'CREATE POLICY tenant_isolation ON "sales_invoice"' in sql
    # NULLIF guards the rolled-back-GUC empty-string case (see rls.py).
    assert "NULLIF(current_setting('app.tenant_id', true), '')::uuid" in sql
    assert "WITH CHECK" in sql  # blocks cross-tenant writes, not just reads


def test_disable_rls_sql_reverses_enable() -> None:
    sql = disable_rls_sql("sales_invoice")
    assert 'DROP POLICY IF EXISTS tenant_isolation ON "sales_invoice";' in sql
    assert "NO FORCE ROW LEVEL SECURITY;" in sql
    assert "DISABLE ROW LEVEL SECURITY;" in sql


@pytest.mark.parametrize("table", ["sales_invoice", "stock_level", "audit_log2", "user"])
def test_valid_table_names_accepted(table: str) -> None:
    assert f'"{table}"' in enable_rls_sql(table)


@pytest.mark.parametrize(
    "table",
    ["sales; DROP TABLE users", "sales-invoice", "Sales_Invoice", "1invoice", ""],
)
def test_invalid_table_names_rejected(table: str) -> None:
    """Table names go into raw SQL — anything but an identifier is refused."""
    with pytest.raises(ValueError, match="Invalid table name"):
        enable_rls_sql(table)


def test_migration_operations_are_reversible_runsql() -> None:
    operations = rls_migration_operations("sales_invoice")
    assert len(operations) == 1
    operation = operations[0]
    assert isinstance(operation, migrations.RunSQL)
    sql = operation.sql
    reverse_sql = operation.reverse_sql
    assert isinstance(sql, str) and "CREATE POLICY" in sql
    assert isinstance(reverse_sql, str) and "DROP POLICY" in reverse_sql


def test_revoke_update_delete_sql_is_role_guarded() -> None:
    """Append-only tables: REVOKE from the app role, skipped when absent.

    The role guard lets the same migration run on production (role exists)
    and on test/CI databases (role never created).
    """
    sql = revoke_update_delete_sql("stock_movement")
    assert 'REVOKE UPDATE, DELETE ON "stock_movement" FROM dokan_app;' in sql
    assert "pg_roles" in sql  # existence guard for test databases

    reverse = grant_update_delete_sql("stock_movement")
    assert 'GRANT UPDATE, DELETE ON "stock_movement" TO dokan_app;' in reverse


def test_revoke_update_delete_rejects_bad_table() -> None:
    with pytest.raises(ValueError, match="Invalid table name"):
        revoke_update_delete_sql("evil; DROP TABLE users")


def test_revoke_operation_is_reversible_runsql() -> None:
    operation = revoke_update_delete_operation("stock_movement")
    assert isinstance(operation, migrations.RunSQL)
    assert isinstance(operation.sql, str) and "REVOKE" in operation.sql
    assert isinstance(operation.reverse_sql, str) and "GRANT" in operation.reverse_sql
