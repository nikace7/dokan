"""Read-side queries for customers; every selector takes an explicit ``user``."""

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
