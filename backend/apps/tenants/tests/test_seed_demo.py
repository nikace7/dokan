"""Tests for the seed_demo management command (local demo data)."""

from io import StringIO

import pytest
from django.core.management import call_command

from apps.accounts.models import User
from apps.catalog.models import Item, ItemVariant
from apps.expenses.models import ExpenseCategory
from apps.inventory.models import StockLevel
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def _seed() -> None:
    call_command("seed_demo", stdout=StringIO())


class TestSeedDemo:
    def test_creates_working_demo_tenant(self) -> None:
        _seed()
        tenant = Tenant.objects.get(slug="demo")
        assert tenant.status == "ACTIVE"
        assert tenant.shopfront_subdomain == "demo-store"
        assert tenant.plan.features["ecommerce"] is True
        owner = User.objects.get(tenant=tenant, phone="9800000000")
        assert owner.check_password("demo1234")
        assert Item.objects.filter(tenant=tenant).count() == 3
        assert ItemVariant.objects.filter(tenant=tenant).count() == 6
        # Opening stock posted: every seeded variant holds 20 units.
        assert StockLevel.objects.filter(tenant=tenant, qty_on_hand=20).count() == 6
        # Starter expense categories.
        assert ExpenseCategory.objects.filter(tenant=tenant).count() == 5
        assert ExpenseCategory.objects.filter(tenant=tenant, name="Rent").exists()

    def test_idempotent_rerun(self) -> None:
        _seed()
        Tenant.objects.filter(slug="demo").update(shopfront_subdomain=None)
        _seed()  # second run must not duplicate or raise
        tenant = Tenant.objects.get(slug="demo")
        assert tenant.shopfront_subdomain == "demo-store"
        assert Item.objects.filter(tenant=tenant).count() == 3
        assert ItemVariant.objects.filter(tenant=tenant).count() == 6
