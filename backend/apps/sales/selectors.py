"""Read-side queries for sales; every selector takes an explicit ``user``.

Cost rule (#10): ``cost_at_sale`` on lines is deferred at the queryset for
users without ``pricing.view_cost``.
"""

from datetime import date
from typing import TYPE_CHECKING
from uuid import UUID

from django.db.models import Prefetch, QuerySet

from apps.sales.models import SalesInvoice, SalesInvoiceItem

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def list_invoices(
    tenant: "Tenant",
    user: "User",
    *,
    status: str = "",
    branch_id: UUID | None = None,
    customer_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_from_bs: str = "",
    date_to_bs: str = "",
) -> QuerySet[SalesInvoice]:
    """Invoice list. AD dates filter business_date_ad; BS strings compare
    lexicographically on the denormalized char(10) column."""
    qs = SalesInvoice.objects.filter(tenant=tenant).select_related(
        "branch", "customer", "rate_type", "created_by"
    )
    if status:
        qs = qs.filter(status=status)
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    if customer_id:
        qs = qs.filter(customer_id=customer_id)
    if date_from:
        qs = qs.filter(business_date_ad__gte=date_from)
    if date_to:
        qs = qs.filter(business_date_ad__lte=date_to)
    if date_from_bs:
        qs = qs.filter(business_date_bs__gte=date_from_bs)
    if date_to_bs:
        qs = qs.filter(business_date_bs__lte=date_to_bs)
    return qs.order_by("-created_at")


def get_invoice(tenant: "Tenant", user: "User", pk: UUID) -> SalesInvoice | None:
    """Invoice detail with lines; cost deferred for non-cost users."""
    items_qs = SalesInvoiceItem.objects.select_related("variant", "variant__item")
    if not user.has_perm("pricing.view_cost"):
        items_qs = items_qs.defer("cost_at_sale")
    return (
        SalesInvoice.objects.filter(tenant=tenant, pk=pk)
        .select_related("branch", "customer", "rate_type", "created_by")
        .prefetch_related(Prefetch("items", queryset=items_qs))
        .first()
    )
