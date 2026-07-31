"""Read-side queries for purchasing; every selector takes an explicit ``user``."""

from typing import TYPE_CHECKING

from django.db.models import QuerySet

from apps.purchasing.models import Supplier

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def list_suppliers(
    tenant: "Tenant",
    user: "User",
    *,
    is_active: bool | None = None,
    search: str = "",
) -> QuerySet[Supplier]:
    qs = Supplier.objects.filter(tenant=tenant)
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    if search:
        qs = (
            qs.filter(name__icontains=search)
            | qs.filter(phone__icontains=search)
            | qs.filter(pan_no__icontains=search)
        ).distinct()
    return qs.order_by("name")
