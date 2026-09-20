"""Tenant-staff read paths for online orders."""

from typing import TYPE_CHECKING

from django.db.models import QuerySet

from apps.storefront.models import StoreOrder

if TYPE_CHECKING:
    from apps.tenants.models import Tenant


def list_orders(
    tenant: "Tenant",
    *,
    status: str = "",
) -> QuerySet[StoreOrder]:
    """Newest-first order inbox, scoped to the request tenant."""
    orders = (
        StoreOrder.objects.filter(tenant=tenant)
        .select_related("branch", "customer", "sales_invoice")
        .prefetch_related("items")
    )
    if status:
        orders = orders.filter(status=status)
    return orders.order_by("-created_at")
