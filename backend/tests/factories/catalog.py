"""Factories for catalog: size charts, categories, brands, items, variants.

Every factory hangs off ``TenantFactory`` (docs/SYSTEM_DESIGN.md §8.7);
related objects inherit the tenant via ``SelfAttribute("..tenant")`` so a
test can pass one tenant and get a consistent graph.
"""

from factory import SelfAttribute, Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.catalog.models import Brand, Category, Item, ItemVariant, SizeChart
from tests.factories.tenant import TenantFactory


class SizeChartFactory(DjangoModelFactory):
    class Meta:
        model = SizeChart

    tenant = SubFactory(TenantFactory)
    name = Sequence(lambda n: f"Chart {n}")
    values = ["S", "M", "L", "XL"]


class CategoryFactory(DjangoModelFactory):
    class Meta:
        model = Category

    tenant = SubFactory(TenantFactory)
    name = Sequence(lambda n: f"Category {n}")


class BrandFactory(DjangoModelFactory):
    class Meta:
        model = Brand

    tenant = SubFactory(TenantFactory)
    name = Sequence(lambda n: f"Brand {n}")


class ItemFactory(DjangoModelFactory):
    class Meta:
        model = Item

    tenant = SubFactory(TenantFactory)
    code = Sequence(lambda n: f"ITEM{n:04d}")
    name = Sequence(lambda n: f"Item {n}")
    category = SubFactory(CategoryFactory, tenant=SelfAttribute("..tenant"))
    size_chart = SubFactory(SizeChartFactory, tenant=SelfAttribute("..tenant"))


class ItemVariantFactory(DjangoModelFactory):
    class Meta:
        model = ItemVariant

    tenant = SubFactory(TenantFactory)
    item = SubFactory(ItemFactory, tenant=SelfAttribute("..tenant"))
    size = "M"
    color = "Black"
    sku = Sequence(lambda n: f"SKU{n:05d}")
