"""Role-filtered dashboard summary built from existing read models."""

from datetime import timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.utils import timezone

from apps.payments.selectors import customer_aging
from apps.reports.selectors.financial import profit_report
from apps.reports.selectors.sales import daily_sales
from apps.reports.selectors.stock import low_stock
from apps.sales import selectors as sales_selectors
from apps.sales.models import SalesInvoice
from apps.tenants.selectors import is_feature_enabled
from core.calendar.bs import ad_to_bs
from core.money import quantize_money

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def dashboard_summary(tenant: "Tenant", user: "User") -> dict[str, Any]:
    """Return only tiles whose underlying data the user may view."""
    today = timezone.localdate()
    today_bs = ad_to_bs(today)
    result: dict[str, Any] = {
        "shop_name": tenant.name,
        "business_date_bs": today_bs,
    }

    if user.has_perm("sale.view"):
        rows = daily_sales(
            tenant,
            user,
            date_from_bs=ad_to_bs(today - timedelta(days=29)),
            date_to_bs=today_bs,
        )
        current = next((row for row in rows if row["business_date_bs"] == today_bs), None)
        result["sales"] = {
            "today_total": current["net_total"] if current else "0.00",
            "bill_count": current["bill_count"] if current else 0,
            "last_30_days": [
                {
                    "business_date_bs": row["business_date_bs"],
                    "net_total": row["net_total"],
                }
                for row in rows
            ],
        }
        invoices = sales_selectors.list_invoices(
            tenant, user, status=SalesInvoice.Status.COMPLETED
        ).filter(doc_type=SalesInvoice.DocType.SALE)[:5]
        result["recent_bills"] = [
            {
                "id": str(invoice.pk),
                "invoice_no": invoice.invoice_no,
                "customer_name": invoice.customer.name if invoice.customer else None,
                "total": str(invoice.total),
                "tender_methods": [
                    tender["method"]
                    for tender in invoice.tenders
                    if isinstance(tender, dict) and tender.get("method")
                ],
                "created_at": invoice.created_at.isoformat(),
            }
            for invoice in invoices
        ]

    if user.has_perm("stock.view"):
        result["low_stock"] = {"count": len(low_stock(tenant, user))}

    if user.has_perm("report.ledger"):
        receivables = customer_aging(tenant)
        total = sum(
            (Decimal(row["total_outstanding"]) for row in receivables),
            Decimal("0"),
        )
        result["dues"] = {
            "customer_count": len(receivables),
            "total_receivable": str(quantize_money(total)),
        }

    if (
        user.has_perm("report.profit")
        and user.has_perm("pricing.view_cost")
        and is_feature_enabled(tenant, "profit_reports")
    ):
        profit = profit_report(
            tenant,
            user,
            date_from_bs=today_bs,
            date_to_bs=today_bs,
        )
        result["profit"] = {"today_net_profit": profit["totals"]["net_profit"]}

    return result
