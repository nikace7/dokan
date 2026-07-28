"""Tests for core/db/rls.py — policy SQL generation (no database needed)."""

import pytest
from django.db import migrations

from core.db.rls import (
    disable_rls_sql,
    enable_rls_sql,
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
