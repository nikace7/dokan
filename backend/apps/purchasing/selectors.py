"""Read-side queries for purchasing; every selector takes an explicit ``user``."""

from datetime import date
from typing import TYPE_CHECKING
from uuid import UUID

from django.db.models import QuerySet

from apps.purchasing.models import PurchaseInvoice, Supplier

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


def list_invoices(
    tenant: "Tenant",
    user: "User",
    *,
    status: str = "",
    supplier_id: "UUID | None" = None,
    date_from: "date | None" = None,
    date_to: "date | None" = None,
) -> QuerySet[PurchaseInvoice]:
    qs = PurchaseInvoice.objects.filter(tenant=tenant).select_related("branch", "supplier")
    if status:
        qs = qs.filter(status=status)
    if supplier_id:
        qs = qs.filter(supplier_id=supplier_id)
    if date_from:
        qs = qs.filter(bill_date_ad__gte=date_from)
    if date_to:
        qs = qs.filter(bill_date_ad__lte=date_to)
    return qs.order_by("-created_at")


def get_invoice(tenant: "Tenant", user: "User", pk: "UUID") -> PurchaseInvoice | None:
    return (
        PurchaseInvoice.objects.filter(tenant=tenant, pk=pk)
        .select_related("branch", "supplier", "created_by")
        .prefetch_related("items__variant__item")
        .first()
    )
