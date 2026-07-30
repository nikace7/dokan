"""Tests for the seed_demo management command (local demo data)."""

from io import StringIO

import pytest
from django.core.management import call_command

from apps.accounts.models import User
from apps.catalog.models import Item, ItemVariant
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
        owner = User.objects.get(tenant=tenant, phone="9800000000")
        assert owner.check_password("demo1234")
        assert Item.objects.filter(tenant=tenant).count() == 3
        assert ItemVariant.objects.filter(tenant=tenant).count() == 6
        # Opening stock posted: every seeded variant holds 20 units.
        assert StockLevel.objects.filter(tenant=tenant, qty_on_hand=20).count() == 6

    def test_idempotent_rerun(self) -> None:
        _seed()
        _seed()  # second run must not duplicate or raise
        tenant = Tenant.objects.get(slug="demo")
        assert Item.objects.filter(tenant=tenant).count() == 3
        assert ItemVariant.objects.filter(tenant=tenant).count() == 6
