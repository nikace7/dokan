"""Stock report selectors — summary, low stock, dead stock.

Cost visibility (invariant 10): ``avg_cost`` and cost valuation are
selected only for users with ``pricing.view_cost``; for everyone else the
columns are never even queried (defer) nor returned.
"""

from datetime import timedelta
from typing import TYPE_CHECKING, Any
from uuid import UUID

from django.db.models import F, QuerySet
from django.utils import timezone

from apps.inventory.models import StockLevel, StockMovement

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def _levels(tenant: "Tenant", branch_id: UUID | None) -> QuerySet[StockLevel]:
    qs = StockLevel.objects.filter(tenant=tenant).select_related(
        "branch", "variant", "variant__item"
    )
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    return qs


def stock_summary(
    tenant: "Tenant", user: "User", *, branch_id: UUID | None = None
) -> list[dict[str, Any]]:
    """Per variant: on hand, cost valuation (cost users only), MRP valuation."""
    can_view_cost = user.has_perm("pricing.view_cost")
    qs = _levels(tenant, branch_id)
    if not can_view_cost:
        qs = qs.defer("avg_cost")
    rows: list[dict[str, Any]] = []
    for level in qs.order_by("variant__sku"):
        row: dict[str, Any] = {
            "variant_id": str(level.variant_id),
            "sku": level.variant.sku,
            "item_name": level.variant.item.name,
            "branch_id": str(level.branch_id),
            "branch_code": level.branch.code,
            "qty_on_hand": str(level.qty_on_hand),
            "mrp": str(level.variant.mrp) if level.variant.mrp is not None else None,
            "mrp_valuation": (
                str(level.qty_on_hand * level.variant.mrp)
                if level.variant.mrp is not None
                else None
            ),
        }
        if can_view_cost:
            row["avg_cost"] = str(level.avg_cost)
            row["cost_valuation"] = str(level.qty_on_hand * level.avg_cost)
        rows.append(row)
    return rows


def low_stock(
    tenant: "Tenant", user: "User", *, branch_id: UUID | None = None
) -> list[dict[str, Any]]:
    """qty_on_hand ≤ item.reorder_level (NULL reorder_level excluded)."""
    qs = (
        _levels(tenant, branch_id)
        .filter(variant__item__reorder_level__isnull=False)
        .filter(qty_on_hand__lte=F("variant__item__reorder_level"))
        .order_by("qty_on_hand", "variant__sku")
    )
    return [
        {
            "variant_id": str(level.variant_id),
            "sku": level.variant.sku,
            "item_name": level.variant.item.name,
            "branch_id": str(level.branch_id),
            "qty_on_hand": str(level.qty_on_hand),
            "reorder_level": str(level.variant.item.reorder_level),
        }
        for level in qs
    ]


def dead_stock(
    tenant: "Tenant",
    user: "User",
    *,
    branch_id: UUID | None = None,
    days: int = 90,
) -> list[dict[str, Any]]:
    """Variants with stock on hand but no SALE movement in the last N days
    (ledger query, not a Python loop). Per branch when branch_id is given,
    else tenant-wide."""
    cutoff = timezone.now() - timedelta(days=days)
    movement_scope = StockMovement.objects.filter(
        tenant=tenant,
        type=StockMovement.MovementType.SALE,
        created_at__gte=cutoff,
    )
    if branch_id:
        movement_scope = movement_scope.filter(branch_id=branch_id)
    recently_sold = movement_scope.values("variant_id")

    qs = _levels(tenant, branch_id).filter(qty_on_hand__gt=0).exclude(variant_id__in=recently_sold)
    return [
        {
            "variant_id": str(level.variant_id),
            "sku": level.variant.sku,
            "item_name": level.variant.item.name,
            "branch_id": str(level.branch_id),
            "qty_on_hand": str(level.qty_on_hand),
        }
        for level in qs.order_by("variant__sku")
    ]
