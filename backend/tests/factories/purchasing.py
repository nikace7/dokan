"""Factories for purchasing: suppliers and purchase invoices."""

from datetime import date
from decimal import Decimal

from factory import LazyAttribute, LazyFunction, SelfAttribute, Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.purchasing.models import PurchaseInvoice, PurchaseInvoiceItem, Supplier
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from tests.factories.accounts import UserFactory
from tests.factories.branch import BranchFactory
from tests.factories.catalog import ItemVariantFactory
from tests.factories.tenant import TenantFactory


class SupplierFactory(DjangoModelFactory):
    class Meta:
        model = Supplier

    tenant = SubFactory(TenantFactory)
    name = Sequence(lambda n: f"Supplier {n}")
    phone = Sequence(lambda n: f"96{n:08d}")


class PurchaseInvoiceFactory(DjangoModelFactory):
    class Meta:
        model = PurchaseInvoice

    tenant = SubFactory(TenantFactory)
    branch = SubFactory(BranchFactory, tenant=SelfAttribute("..tenant"))
    supplier = SubFactory(SupplierFactory, tenant=SelfAttribute("..tenant"))
    created_by = SubFactory(UserFactory, tenant=SelfAttribute("..tenant"))
    bill_date_ad = LazyFunction(date.today)
    bill_date_bs = LazyAttribute(lambda o: ad_to_bs(o.bill_date_ad))
    fiscal_year_bs = LazyAttribute(lambda o: fiscal_year_bs(o.bill_date_ad))


class PurchaseInvoiceItemFactory(DjangoModelFactory):
    class Meta:
        model = PurchaseInvoiceItem

    tenant = SubFactory(TenantFactory)
    invoice = SubFactory(PurchaseInvoiceFactory, tenant=SelfAttribute("..tenant"))
    variant = SubFactory(ItemVariantFactory, tenant=SelfAttribute("..tenant"))
    qty = Decimal("1")
    unit_cost = Decimal("100.00")
    line_total = Decimal("100.00")
