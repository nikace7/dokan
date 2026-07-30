"""Factories for sales: number sequences, invoices, invoice lines."""

from datetime import date
from decimal import Decimal

from django.utils import timezone
from factory import LazyAttribute, LazyFunction, SelfAttribute, Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.sales.models import NumberSequence, SalesInvoice, SalesInvoiceItem
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from tests.factories.accounts import UserFactory
from tests.factories.branch import BranchFactory
from tests.factories.catalog import ItemVariantFactory
from tests.factories.pricing import RateTypeFactory
from tests.factories.tenant import TenantFactory


class NumberSequenceFactory(DjangoModelFactory):
    class Meta:
        model = NumberSequence

    tenant = SubFactory(TenantFactory)
    branch = SubFactory(BranchFactory, tenant=SelfAttribute("..tenant"))
    doc_type = "SALE"
    fiscal_year_bs = "2082-83"
    prefix = "INV"
    next_number = 1


class SalesInvoiceFactory(DjangoModelFactory):
    class Meta:
        model = SalesInvoice

    tenant = SubFactory(TenantFactory)
    branch = SubFactory(BranchFactory, tenant=SelfAttribute("..tenant"))
    rate_type = SubFactory(RateTypeFactory, tenant=SelfAttribute("..tenant"))
    status = SalesInvoice.Status.COMPLETED
    subtotal = Decimal("1000.00")
    taxable_amount = Decimal("1000.00")
    total = Decimal("1000.00")
    paid_amount = Decimal("1000.00")
    due_amount = Decimal("0")
    idempotency_key = Sequence(lambda n: f"key-{n}")
    created_by = SubFactory(UserFactory, tenant=SelfAttribute("..tenant"))

    datetime_ad = LazyFunction(timezone.now)
    business_date_ad = LazyFunction(date.today)
    business_date_bs = LazyAttribute(lambda o: ad_to_bs(o.business_date_ad))
    fiscal_year_bs = LazyAttribute(lambda o: fiscal_year_bs(o.business_date_ad))


class SalesInvoiceItemFactory(DjangoModelFactory):
    class Meta:
        model = SalesInvoiceItem

    tenant = SubFactory(TenantFactory)
    invoice = SubFactory(SalesInvoiceFactory, tenant=SelfAttribute("..tenant"))
    variant = SubFactory(ItemVariantFactory, tenant=SelfAttribute("..tenant"))
    qty = Decimal("1")
    rate_type = SubFactory(RateTypeFactory, tenant=SelfAttribute("..tenant"))
    unit_price = Decimal("1000.00")
    line_total = Decimal("1000.00")
    cost_at_sale = Decimal("600.00")
