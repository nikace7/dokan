"""Factories for the storefront app: settings, customers, OTPs, orders."""

from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone
from factory import LazyAttribute, LazyFunction, SelfAttribute, Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.storefront.models import (
    StoreCustomer,
    StoreOrder,
    StoreOrderItem,
    StoreOtp,
    StoreSettings,
)
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from tests.factories.branch import BranchFactory
from tests.factories.catalog import ItemVariantFactory
from tests.factories.tenant import TenantFactory


class StoreSettingsFactory(DjangoModelFactory):
    class Meta:
        model = StoreSettings

    tenant = SubFactory(TenantFactory)


class StoreCustomerFactory(DjangoModelFactory):
    class Meta:
        model = StoreCustomer

    tenant = SubFactory(TenantFactory)
    email = Sequence(lambda n: f"shopper{n}@example.com")
    full_name = "Sita Shopper"
    phone = "9811111111"


class StoreOtpFactory(DjangoModelFactory):
    class Meta:
        model = StoreOtp

    tenant = SubFactory(TenantFactory)
    email = Sequence(lambda n: f"shopper{n}@example.com")
    code_hash = "0" * 64
    expires_at = LazyFunction(lambda: timezone.now() + timedelta(minutes=10))


class StoreOrderFactory(DjangoModelFactory):
    class Meta:
        model = StoreOrder

    tenant = SubFactory(TenantFactory)
    branch = SubFactory(BranchFactory, tenant=SelfAttribute("..tenant"))
    customer = SubFactory(StoreCustomerFactory, tenant=SelfAttribute("..tenant"))
    order_number = Sequence(lambda n: n + 1)
    number_text = Sequence(lambda n: f"ORD-{n + 1:06d}")
    fulfillment = StoreOrder.Fulfillment.PICKUP
    payment_method = StoreOrder.PaymentMethod.COD
    currency = "NPR"
    subtotal = Decimal("1000.00")
    total = Decimal("1000.00")
    business_date_ad = LazyFunction(date.today)
    business_date_bs = LazyAttribute(lambda o: ad_to_bs(o.business_date_ad))
    fiscal_year_bs = LazyAttribute(lambda o: fiscal_year_bs(o.business_date_ad))


class StoreOrderItemFactory(DjangoModelFactory):
    class Meta:
        model = StoreOrderItem

    tenant = SubFactory(TenantFactory)
    order = SubFactory(StoreOrderFactory, tenant=SelfAttribute("..tenant"))
    variant = SubFactory(ItemVariantFactory, tenant=SelfAttribute("..tenant"))
    name = "Plain T-Shirt"
    size = "M"
    color = "Black"
    unit_price = Decimal("1000.00")
    qty = Decimal("1")
    line_total = Decimal("1000.00")
