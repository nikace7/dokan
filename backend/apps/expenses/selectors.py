"""Read-side queries for expenses; every selector takes an explicit ``user``."""

from datetime import date
from typing import TYPE_CHECKING, Any
from uuid import UUID

from django.db.models import QuerySet, Sum
from django.db.models.functions import Substr

from apps.expenses.models import Expense, ExpenseCategory
from apps.reports.selectors._shared import resolve_date_range, validate_bs_date
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def list_categories(
    tenant: "Tenant", user: "User", *, is_active: bool | None = None
) -> QuerySet[ExpenseCategory]:
    qs = ExpenseCategory.objects.filter(tenant=tenant)
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    return qs.order_by("name")


def list_expenses(
    tenant: "Tenant",
    user: "User",
    *,
    category_id: UUID | None = None,
    branch_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_from_bs: str = "",
    date_to_bs: str = "",
) -> QuerySet[Expense]:
    """Expense list — AD or BS date filters (BS compares lexicographically)."""
    qs = Expense.objects.filter(tenant=tenant).select_related("branch", "category", "created_by")
    if category_id:
        qs = qs.filter(category_id=category_id)
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    if date_from:
        qs = qs.filter(business_date_ad__gte=date_from)
    if date_to:
        qs = qs.filter(business_date_ad__lte=date_to)
    if date_from_bs:
        validate_bs_date(date_from_bs, "date_from_bs")
        qs = qs.filter(business_date_bs__gte=date_from_bs)
    if date_to_bs:
        validate_bs_date(date_to_bs, "date_to_bs")
        qs = qs.filter(business_date_bs__lte=date_to_bs)
    return qs.order_by("-business_date_ad", "-created_at")


def expense_summary(
    tenant: "Tenant",
    user: "User",
    *,
    date_from_bs: str | None = None,
    date_to_bs: str | None = None,
    group_by: str = "category",
) -> dict[str, Any]:
    """Totals grouped by category or BS month (7-char prefix, same trick
    as the reports app — no conversion anywhere)."""
    if group_by not in {"category", "month"}:
        raise ServiceError("GROUP_BY_INVALID", "group_by must be 'category' or 'month'.")
    from_bs, to_bs = resolve_date_range(date_from_bs, date_to_bs)
    base = Expense.objects.filter(
        tenant=tenant, business_date_bs__gte=from_bs, business_date_bs__lte=to_bs
    )
    total = base.aggregate(total=Sum("amount"))["total"] or 0

    if group_by == "category":
        category_rows = (
            base.values("category__name")
            .annotate(total=Sum("amount"), count=Sum(1))
            .order_by("-total")
        )
        groups = [
            {"key": row["category__name"], "count": row["count"], "total": str(row["total"])}
            for row in category_rows
        ]
    else:
        month_rows = (
            base.annotate(bs_month=Substr("business_date_bs", 1, 7))
            .values("bs_month")
            .annotate(total=Sum("amount"), count=Sum(1))
            .order_by("bs_month")
        )
        groups = [
            {"key": row["bs_month"], "count": row["count"], "total": str(row["total"])}
            for row in month_rows
        ]
    return {
        "date_from_bs": from_bs,
        "date_to_bs": to_bs,
        "group_by": group_by,
        "groups": groups,
        "total": str(total),
    }


def expenses_by_month(tenant: "Tenant", *, from_bs: str, to_bs: str) -> dict[str, Any]:
    """Expense totals keyed by BS month — used by profit_report's net math."""
    from decimal import Decimal

    rows = (
        Expense.objects.filter(
            tenant=tenant, business_date_bs__gte=from_bs, business_date_bs__lte=to_bs
        )
        .annotate(bs_month=Substr("business_date_bs", 1, 7))
        .values("bs_month")
        .annotate(total=Sum("amount"))
    )
    return {row["bs_month"]: row["total"] or Decimal("0") for row in rows}
