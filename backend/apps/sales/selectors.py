"""Read-side queries for sales; every selector takes an explicit ``user``.

Cost rule (#10): ``cost_at_sale`` on lines is deferred at the queryset for
users without ``pricing.view_cost``.
"""

from datetime import date
from typing import TYPE_CHECKING, Any
from uuid import UUID

from django.db import connection, transaction
from django.db.models import Count, IntegerField, OuterRef, Prefetch, QuerySet, Subquery, Value
from django.db.models.functions import Coalesce

from apps.audit.models import AuditLog
from apps.sales.models import SalesInvoice, SalesInvoiceItem
from core.db.rls import set_local_tenant
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def _with_receipt_print_count(qs: QuerySet[SalesInvoice]) -> QuerySet[SalesInvoice]:
    counts = (
        AuditLog.objects.filter(
            tenant_id=OuterRef("tenant_id"),
            action="sale.receipt.print",
            target_type="sales_invoice",
            target_id=OuterRef("pk"),
        )
        .values("target_id")
        .annotate(total=Count("id"))
        .values("total")[:1]
    )
    return qs.annotate(
        receipt_print_count=Coalesce(Subquery(counts, output_field=IntegerField()), Value(0))
    )


def list_invoices(
    tenant: "Tenant",
    user: "User",
    *,
    status: str = "",
    doc_type: str = "",
    branch_id: UUID | None = None,
    customer_id: UUID | None = None,
    invoice_no: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_from_bs: str = "",
    date_to_bs: str = "",
) -> QuerySet[SalesInvoice]:
    """Invoice list. AD dates filter business_date_ad; BS strings compare
    lexicographically on the denormalized char(10) column."""
    qs = _with_receipt_print_count(
        SalesInvoice.objects.filter(tenant=tenant).select_related(
            "tenant", "branch", "customer", "rate_type", "created_by"
        )
    )
    if status:
        qs = qs.filter(status=status)
    if doc_type:
        qs = qs.filter(doc_type=doc_type)
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    if customer_id:
        qs = qs.filter(customer_id=customer_id)
    if invoice_no is not None:
        qs = qs.filter(invoice_no=invoice_no)
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
        _with_receipt_print_count(SalesInvoice.objects.filter(tenant=tenant, pk=pk))
        .select_related("tenant", "branch", "customer", "rate_type", "created_by")
        .prefetch_related(Prefetch("items", queryset=items_qs))
        .first()
    )


def get_shared_invoice(token: UUID) -> SalesInvoice | None:
    """Public share-link lookup — the ONLY deliberate cross-tenant read.

    Step 1 finds the invoice's tenant from the globally-unique token. Step 2
    re-reads the invoice (lines prefetched, cost columns deferred) inside a
    transaction with ``SET LOCAL app.tenant_id`` pinned to THAT tenant — the
    same explicit-RLS pattern platformadmin uses for cross-tenant reads
    (core/db/rls.py ``set_local_tenant``).

    RLS note: under the production app role, step 1 only returns a row when
    the request already carries the right tenant context (the share URL is
    opened on the shop's own subdomain) — anywhere else it fails closed and
    the view answers 404. Line cost columns are NEVER selected (#10).
    """
    tenant_id = (
        SalesInvoice.objects.filter(share_token=token).values_list("tenant_id", flat=True).first()
    )
    if tenant_id is None:
        return None
    with transaction.atomic():
        set_local_tenant(connection, tenant_id)
        items_qs = SalesInvoiceItem.objects.select_related("variant", "variant__item").defer(
            "cost_at_sale"
        )
        return (
            _with_receipt_print_count(
                SalesInvoice.objects.filter(tenant_id=tenant_id, share_token=token)
            )
            .select_related("tenant", "branch", "customer", "rate_type")
            .prefetch_related(Prefetch("items", queryset=items_qs))
            .first()
        )


def get_returnable_lines(
    tenant: "Tenant", user: "User", invoice_pk: UUID
) -> list[dict[str, Any]] | None:
    """Per-line remaining-returnable quantities for the exchange screen.

    None when the invoice doesn't exist (view maps to 404); empty list is
    valid (fully returned bill). Only COMPLETED SALE docs are returnable.
    """
    invoice = (
        SalesInvoice.objects.filter(tenant=tenant, pk=invoice_pk)
        .prefetch_related("items__variant__item")
        .first()
    )
    if invoice is None:
        return None
    if (
        invoice.doc_type != SalesInvoice.DocType.SALE
        or invoice.status != SalesInvoice.Status.COMPLETED
    ):
        raise ServiceError(
            "RETURN_NOT_ALLOWED",
            "Only completed sale bills have returnable lines.",
            http_status=409,
        )
    return [
        {
            "variant": str(item.variant_id),
            "sku": item.variant.sku,
            "item_name": item.variant.item.name,
            "qty": str(item.qty),
            "returned_qty": str(item.returned_qty),
            "remaining": str(item.qty - item.returned_qty),
        }
        for item in invoice.items.all()
    ]
