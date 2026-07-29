"""Factories for inventory: stock levels and ledger movements."""

from datetime import date
from decimal import Decimal

from factory import LazyAttribute, LazyFunction, SelfAttribute, SubFactory
from factory.declarations import Sequence
from factory.django import DjangoModelFactory

from apps.inventory.models import StockLevel, StockMovement
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from tests.factories.branch import BranchFactory
from tests.factories.catalog import ItemVariantFactory
from tests.factories.tenant import TenantFactory


class StockLevelFactory(DjangoModelFactory):
    class Meta:
        model = StockLevel

    tenant = SubFactory(TenantFactory)
    branch = SubFactory(BranchFactory, tenant=SelfAttribute("..tenant"))
    variant = SubFactory(ItemVariantFactory, tenant=SelfAttribute("..tenant"))
    qty_on_hand = Decimal("0")
    avg_cost = Decimal("0")


class StockMovementFactory(DjangoModelFactory):
    class Meta:
        model = StockMovement

    tenant = SubFactory(TenantFactory)
    branch = SubFactory(BranchFactory, tenant=SelfAttribute("..tenant"))
    variant = SubFactory(ItemVariantFactory, tenant=SelfAttribute("..tenant"))
    type = StockMovement.MovementType.OPENING
    qty_delta = Decimal("1")
    balance_after = Decimal("1")
    note = Sequence(lambda n: f"note-{n}")

    business_date_ad = LazyFunction(date.today)
    business_date_bs = LazyAttribute(lambda o: ad_to_bs(o.business_date_ad))
    fiscal_year_bs = LazyAttribute(lambda o: fiscal_year_bs(o.business_date_ad))
