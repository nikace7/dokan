"""Factories for payments: payments, allocations, cash sessions."""

from datetime import date
from decimal import Decimal

from django.utils import timezone
from factory import LazyAttribute, LazyFunction, SelfAttribute, Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.payments.models import CashSession, Payment, PaymentAllocation
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from tests.factories.accounts import UserFactory
from tests.factories.branch import BranchFactory
from tests.factories.customers import CustomerFactory
from tests.factories.sales import SalesInvoiceFactory
from tests.factories.tenant import TenantFactory


class PaymentFactory(DjangoModelFactory):
    class Meta:
        model = Payment

    tenant = SubFactory(TenantFactory)
    branch = SubFactory(BranchFactory, tenant=SelfAttribute("..tenant"))
    direction = Payment.Direction.RECEIPT
    party_type = Payment.PartyType.CUSTOMER
    customer = SubFactory(CustomerFactory, tenant=SelfAttribute("..tenant"))
    supplier = None
    method = Payment.Method.CASH
    amount = Decimal("500.00")
    idempotency_key = Sequence(lambda n: f"pay-key-{n}")
    created_by = SubFactory(UserFactory, tenant=SelfAttribute("..tenant"))

    business_date_ad = LazyFunction(date.today)
    business_date_bs = LazyAttribute(lambda o: ad_to_bs(o.business_date_ad))
    fiscal_year_bs = LazyAttribute(lambda o: fiscal_year_bs(o.business_date_ad))


class PaymentAllocationFactory(DjangoModelFactory):
    class Meta:
        model = PaymentAllocation

    tenant = SubFactory(TenantFactory)
    payment = SubFactory(PaymentFactory, tenant=SelfAttribute("..tenant"))
    sales_invoice = SubFactory(SalesInvoiceFactory, tenant=SelfAttribute("..tenant"))
    amount = Decimal("100.00")


class CashSessionFactory(DjangoModelFactory):
    class Meta:
        model = CashSession

    tenant = SubFactory(TenantFactory)
    branch = SubFactory(BranchFactory, tenant=SelfAttribute("..tenant"))
    opened_by = SubFactory(UserFactory, tenant=SelfAttribute("..tenant"))
    opened_at = LazyFunction(timezone.now)
    opening_float = Decimal("1000.00")
