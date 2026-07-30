"""Factories for pricing: rate types, prices, change-log rows."""

from datetime import date
from decimal import Decimal
from uuid import uuid4

from factory import LazyFunction, SelfAttribute, Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.pricing.models import ItemPrice, PriceChangeLog, RateType
from tests.factories.catalog import CategoryFactory, ItemVariantFactory
from tests.factories.tenant import TenantFactory


class RateTypeFactory(DjangoModelFactory):
    class Meta:
        model = RateType

    tenant = SubFactory(TenantFactory)
    code = Sequence(lambda n: f"RATE{n:03d}")
    name = Sequence(lambda n: f"Rate {n}")
    is_default = False


class ItemPriceFactory(DjangoModelFactory):
    class Meta:
        model = ItemPrice

    tenant = SubFactory(TenantFactory)
    rate_type = SubFactory(RateTypeFactory, tenant=SelfAttribute("..tenant"))
    scope = ItemPrice.Scope.VARIANT
    variant = SubFactory(ItemVariantFactory, tenant=SelfAttribute("..tenant"))
    price = Decimal("1000.00")
    effective_from = LazyFunction(lambda: date(2026, 1, 1))


class ItemCategoryPriceFactory(ItemPriceFactory):
    """A CATEGORY-scope price (variant FK cleared, category set)."""

    scope = ItemPrice.Scope.CATEGORY
    variant = None
    category = SubFactory(CategoryFactory, tenant=SelfAttribute("..tenant"))


class PriceChangeLogFactory(DjangoModelFactory):
    class Meta:
        model = PriceChangeLog

    tenant = SubFactory(TenantFactory)
    target_type = PriceChangeLog.TargetType.VARIANT
    target_id = LazyFunction(uuid4)
    rate_type = SubFactory(RateTypeFactory, tenant=SelfAttribute("..tenant"))
    new_price = Decimal("1000.00")
