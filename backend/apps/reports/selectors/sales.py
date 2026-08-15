"""Sales report selectors — plain GROUP BYs on denormalized BS columns.

Returns handling (documented): RETURN documents are stored with POSITIVE
amounts, so sales reports show them as separate ``returns_*`` columns
(count + total of credit notes). Net sales = total − returns_total; the
``net_total`` column is computed here for convenience.
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any
from uuid import UUID

from django.db.models import Count, Q, Sum
from django.db.models.functions import Substr

from apps.reports.selectors._shared import resolve_date_range
from apps.sales.models import SalesInvoice, SalesInvoiceItem
from apps.sales.services.create_sale import PAYMENT_METHODS
from core.money import quantize_money

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_COMPLETED = SalesInvoice.Status.COMPLETED
_SALE = SalesInvoice.DocType.SALE
_RETURN = SalesInvoice.DocType.RETURN


def _base(tenant: "Tenant", branch_id: UUID | None, from_bs: str, to_bs: str) -> Any:
    qs = SalesInvoice.objects.filter(
        tenant=tenant,
        status=_COMPLETED,
        business_date_bs__gte=from_bs,
        business_date_bs__lte=to_bs,
    )
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    return qs


def daily_sales(
    tenant: "Tenant",
    user: "User",
    *,
    branch_id: UUID | None = None,
    date_from_bs: str | None = None,
    date_to_bs: str | None = None,
) -> list[dict[str, Any]]:
    """Per business_date_bs: bills, gross, discount, VAT, net, paid, due,
    plus the returns columns (documented convention above)."""
    from_bs, to_bs = resolve_date_range(date_from_bs, date_to_bs)
    qs = (
        _base(tenant, branch_id, from_bs, to_bs)
        .values("business_date_bs")
        .annotate(
            bill_count=Count("id", filter=Q(doc_type=_SALE)),
            subtotal=Sum("subtotal", filter=Q(doc_type=_SALE)),
            discount=Sum("discount_amount", filter=Q(doc_type=_SALE)),
            vat=Sum("vat_amount", filter=Q(doc_type=_SALE)),
            sales_total=Sum("total", filter=Q(doc_type=_SALE)),
            sales_paid=Sum("paid_amount", filter=Q(doc_type=_SALE)),
            sales_due=Sum("due_amount", filter=Q(doc_type=_SALE)),
            returns_count=Count("id", filter=Q(doc_type=_RETURN)),
            returns_total=Sum("total", filter=Q(doc_type=_RETURN)),
        )
        .order_by("business_date_bs")
    )
    return [
        {
            "business_date_bs": row["business_date_bs"],
            "bill_count": row["bill_count"],
            "subtotal": str(row["subtotal"] or 0),
            "discount": str(row["discount"] or 0),
            "vat": str(row["vat"] or 0),
            "total": str(row["sales_total"] or 0),
            "paid": str(row["sales_paid"] or 0),
            "due": str(row["sales_due"] or 0),
            "returns_count": row["returns_count"],
            "returns_total": str(row["returns_total"] or 0),
            "net_total": str((row["sales_total"] or 0) - (row["returns_total"] or 0)),
        }
        for row in qs
    ]


def monthly_sales(
    tenant: "Tenant",
    user: "User",
    *,
    fiscal_year_bs: str | None = None,
) -> list[dict[str, Any]]:
    """GROUP BY BS month — the 7-char prefix of business_date_bs IS the
    month (zero-padded char(10)); no conversion, one indexed scan."""
    base = SalesInvoice.objects.filter(tenant=tenant, status=_COMPLETED)
    if fiscal_year_bs:
        base = base.filter(fiscal_year_bs=fiscal_year_bs)
    qs = (
        base.annotate(bs_month=Substr("business_date_bs", 1, 7))
        .values("bs_month")
        .annotate(
            bill_count=Count("id", filter=Q(doc_type=_SALE)),
            sales_total=Sum("total", filter=Q(doc_type=_SALE)),
            discount=Sum("discount_amount", filter=Q(doc_type=_SALE)),
            vat=Sum("vat_amount", filter=Q(doc_type=_SALE)),
            returns_total=Sum("total", filter=Q(doc_type=_RETURN)),
        )
        .order_by("bs_month")
    )
    return [
        {
            "bs_month": row["bs_month"],
            "bill_count": row["bill_count"],
            "total": str(row["sales_total"] or 0),
            "discount": str(row["discount"] or 0),
            "vat": str(row["vat"] or 0),
            "returns_total": str(row["returns_total"] or 0),
            "net_total": str((row["sales_total"] or 0) - (row["returns_total"] or 0)),
        }
        for row in qs
    ]


def item_sales(
    tenant: "Tenant",
    user: "User",
    *,
    date_from_bs: str | None = None,
    date_to_bs: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Top-selling variants by qty, with amount (COMPLETED sales in range)."""
    from_bs, to_bs = resolve_date_range(date_from_bs, date_to_bs)
    qs = (
        SalesInvoiceItem.objects.filter(
            tenant=tenant,
            invoice__status=_COMPLETED,
            invoice__doc_type=_SALE,
            invoice__business_date_bs__gte=from_bs,
            invoice__business_date_bs__lte=to_bs,
        )
        .values(
            "variant_id", "variant__sku", "variant__item__name", "variant__size", "variant__color"
        )
        .annotate(qty=Sum("qty"), amount=Sum("line_total"))
        .order_by("-qty", "-amount")[:limit]
    )
    return [
        {
            "variant_id": str(row["variant_id"]),
            "sku": row["variant__sku"],
            "item_name": row["variant__item__name"],
            "size": row["variant__size"],
            "color": row["variant__color"],
            "qty": str(row["qty"]),
            "amount": str(row["amount"]),
        }
        for row in qs
    ]


def collections_by_tender(
    tenant: "Tenant",
    user: "User",
    *,
    branch_id: UUID | None = None,
    date_from_bs: str | None = None,
    date_to_bs: str | None = None,
) -> dict[str, Any]:
    """Collections grouped by payment method over COMPLETED SALE invoices.

    Reads the tenders JSON list on each invoice — the same source the
    tender-aware cash-session expected-cash uses (apps/payments). CREDIT
    and POINTS are not collections (udharo / loyalty redemption), so they
    are excluded. No cost fields are involved anywhere in this report.
    """
    from_bs, to_bs = resolve_date_range(date_from_bs, date_to_bs)
    rows = (
        _base(tenant, branch_id, from_bs, to_bs)
        .filter(doc_type=_SALE)
        .values_list("tenders", flat=True)
    )
    non_collections = {"CREDIT", "POINTS"}
    by_method: dict[str, dict[str, Any]] = {}
    for tenders in rows:
        for tender in tenders:
            if not isinstance(tender, dict):
                continue
            method = tender.get("method")
            if not method or method in non_collections or method not in PAYMENT_METHODS:
                continue
            amount = Decimal(str(tender.get("amount", "0")))
            if amount <= 0:
                continue
            entry = by_method.setdefault(
                method, {"method": method, "amount": Decimal("0"), "count": 0}
            )
            entry["amount"] += amount
            entry["count"] += 1

    methods = sorted(by_method.values(), key=lambda e: (-e["amount"], e["method"]))
    grand_total = quantize_money(sum((entry["amount"] for entry in methods), Decimal("0")))
    return {
        "date_from_bs": from_bs,
        "date_to_bs": to_bs,
        "methods": [
            {
                "method": entry["method"],
                "amount": str(quantize_money(entry["amount"])),
                "count": entry["count"],
            }
            for entry in methods
        ],
        "total": str(grand_total),
    }
