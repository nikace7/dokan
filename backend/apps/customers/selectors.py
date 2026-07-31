"""Read-side queries for customers; every selector takes an explicit ``user``."""

from decimal import Decimal
from typing import TYPE_CHECKING

from django.db.models import QuerySet

from apps.customers.models import Customer

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def list_customers(
    tenant: "Tenant",
    user: "User",
    *,
    is_active: bool | None = None,
    search: str = "",
) -> QuerySet[Customer]:
    """Customer list with name/phone search (POS customer attach)."""
    qs = Customer.objects.filter(tenant=tenant)
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    if search:
        qs = (qs.filter(name__icontains=search) | qs.filter(phone__icontains=search)).distinct()
    return qs.order_by("name")


def get_customer_outstanding(tenant: "Tenant", customer: Customer) -> Decimal:
    """Canonical outstanding — delegates to apps/payments/selectors.py
    (single implementation: dues − credit notes − receipts)."""
    from apps.payments.selectors import customer_outstanding

    return customer_outstanding(tenant, customer)


def get_customer_outstanding_breakdown(tenant: "Tenant", customer: Customer) -> dict[str, Decimal]:
    """The components of outstanding — delegates to the canonical
    payments selector (adds the receipts component)."""
    from apps.payments.selectors import customer_outstanding_breakdown

    return customer_outstanding_breakdown(tenant, customer)
