"""Built-in role permissions and the migration that updates existing shops."""

from importlib import import_module

import pytest
from django.apps import apps
from django.db import connection

from apps.accounts.models import RolePermission
from apps.accounts.system_roles import SYSTEM_ROLE_PERMISSIONS
from tests.factories import RoleFactory, TenantFactory

pytestmark = pytest.mark.django_db

migration = import_module("apps.accounts.migrations.0003_cashier_cash_drawer")


def _codes(role: object) -> set[str]:
    return set(RolePermission.objects.filter(role=role).values_list("permission_id", flat=True))


class TestCashierCashDrawer:
    def test_new_shops_cashier_can_open_and_close_the_drawer(self) -> None:
        assert "cash.manage" in SYSTEM_ROLE_PERMISSIONS["CASHIER"]

    def test_migration_grants_existing_system_cashiers_only(self) -> None:
        shop = TenantFactory(slug="shop-a")
        cashier = RoleFactory(tenant=shop, code="CASHIER", is_system=True)
        stock_keeper = RoleFactory(tenant=shop, code="STOCK_KEEPER", is_system=True)
        # An owner-made role that happens to use the code is left alone.
        other = TenantFactory(slug="shop-b")
        custom = RoleFactory(tenant=other, code="CASHIER", is_system=False)

        with connection.schema_editor() as editor:
            migration.grant_cash_drawer(apps, editor)
            migration.grant_cash_drawer(apps, editor)  # idempotent

        assert _codes(cashier) == {"cash.manage"}
        assert _codes(stock_keeper) == set()
        assert _codes(custom) == set()

        with connection.schema_editor() as editor:
            migration.revoke_cash_drawer(apps, editor)
        assert _codes(cashier) == set()
