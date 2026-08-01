"""Financial report selectors — profit (cost-gated) and dues.

Profit rule (invariants 2 + 10): COGS comes ONLY from the snapshotted
``cost_at_sale`` per line — never recomputed, never the current avg_cost —
and the whole report requires BOTH report.profit and pricing.view_cost.
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db.models import F, Sum
from django.db.models.functions import Substr

from apps.payments.selectors import customer_aging, supplier_payable
from apps.purchasing.models import Supplier
from apps.reports.selectors._shared import resolve_date_range
from apps.sales.models import SalesInvoice, SalesInvoiceItem
from core.money import quantize_money

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_COMPLETED = SalesInvoice.Status.COMPLETED
_SALE = SalesInvoice.DocType.SALE
_RETURN = SalesInvoice.DocType.RETURN


def profit_report(
    tenant: "Tenant",
    user: "User",
    *,
    date_from_bs: str | None = None,
    date_to_bs: str | None = None,
) -> dict[str, Any]:
    """Profit per BS month + totals: gross (revenue − COGS) and NET
    (gross − expenses). Without expenses, "profit" is only gross margin
    (design §1.2) — expenses are grouped by the same BS-month prefix.

    revenue = COMPLETED sale totals − return credit totals.
    COGS    = Σ cost_at_sale × (qty − returned_qty) over sale lines,
    reduced by the returned lines' own snapshot cost (returns bring stock
    back at the same cost).
    The caller (view) enforces report.profit + pricing.view_cost BEFORE
    calling — this selector is cost data by definition.
    """
    from_bs, to_bs = resolve_date_range(date_from_bs, date_to_bs)

    invoices = SalesInvoice.objects.filter(
        tenant=tenant,
        status=_COMPLETED,
        business_date_bs__gte=from_bs,
        business_date_bs__lte=to_bs,
    )
    revenue_rows = (
        invoices.filter(doc_type=_SALE)
        .annotate(bs_month=Substr("business_date_bs", 1, 7))
        .values("bs_month")
        .annotate(sales_total=Sum("total"))
    )

    cogs_rows = (
        SalesInvoiceItem.objects.filter(
            tenant=tenant,
            invoice__status=_COMPLETED,
            invoice__doc_type=_SALE,
            invoice__business_date_bs__gte=from_bs,
            invoice__business_date_bs__lte=to_bs,
        )
        .annotate(bs_month=Substr("invoice__business_date_bs", 1, 7))
        .values("bs_month")
        .annotate(
            cogs=Sum((F("qty") - F("returned_qty")) * F("cost_at_sale")),
        )
    )
    cogs_by_month = {row["bs_month"]: row["cogs"] for row in cogs_rows}

    returns_rows = (
        invoices.filter(doc_type=_RETURN)
        .annotate(bs_month=Substr("business_date_bs", 1, 7))
        .values("bs_month")
        .annotate(returns_total=Sum("total"))
    )
    returns_by_month = {row["bs_month"]: row["returns_total"] for row in returns_rows}

    from apps.expenses.selectors import expenses_by_month

    expense_by_month = expenses_by_month(tenant, from_bs=from_bs, to_bs=to_bs)

    months = sorted(
        {row["bs_month"] for row in revenue_rows}
        | set(cogs_by_month)
        | set(returns_by_month)
        | set(expense_by_month)
    )
    rows: list[dict[str, Any]] = []
    totals = {
        "revenue": Decimal("0"),
        "cogs": Decimal("0"),
        "gross_profit": Decimal("0"),
        "expenses": Decimal("0"),
        "net_profit": Decimal("0"),
    }
    for month in months:
        sales_total = (
            next((r["sales_total"] for r in revenue_rows if r["bs_month"] == month), 0) or 0
        )
        returns_total = returns_by_month.get(month) or 0
        cogs = quantize_money(cogs_by_month.get(month) or 0)
        expenses = expense_by_month.get(month) or Decimal("0")
        revenue = sales_total - returns_total
        gross = revenue - cogs
        net = gross - expenses
        rows.append(
            {
                "bs_month": month,
                "sales_total": str(sales_total),
                "returns_total": str(returns_total),
                "revenue": str(revenue),
                "cogs": str(cogs),
                "gross_profit": str(gross),
                "expenses": str(expenses),
                "net_profit": str(net),
            }
        )
        totals["revenue"] += revenue
        totals["cogs"] += cogs
        totals["gross_profit"] += gross
        totals["expenses"] += expenses
        totals["net_profit"] += net
    return {
        "date_from_bs": from_bs,
        "date_to_bs": to_bs,
        "rows": rows,
        "totals": {key: str(value) for key, value in totals.items()},
    }


def dues_report(tenant: "Tenant", user: "User") -> dict[str, Any]:
    """Receivables aging (canonical, from payments selectors) + payables."""
    receivables = customer_aging(tenant)
    payables = [
        {
            "supplier_id": str(supplier.pk),
            "supplier_name": supplier.name,
            "payable": str(supplier_payable(tenant, supplier)),
        }
        for supplier in Supplier.objects.filter(tenant=tenant, is_active=True)
        if supplier_payable(tenant, supplier) > 0
    ]
    return {"receivables": receivables, "payables": payables}
