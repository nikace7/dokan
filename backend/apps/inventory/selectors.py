"""Read-side queries for inventory; every selector takes an explicit ``user``.

Cost-visibility rule (ARCHITECTURE §6 invariant 10): ``avg_cost`` / ``unit_cost``
are deferred AT THE QUERYSET for users without ``pricing.view_cost`` — the
columns never enter application memory for them.
"""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any
from uuid import UUID

from django.db import models
from django.db.models import F, QuerySet, Sum
from django.db.models.functions import Coalesce

from apps.inventory.models import (
    StockCount,
    StockLevel,
    StockMovement,
    StockTransfer,
    StockTransferItem,
)
from core.money import quantize_money

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def stock_totals(tenant: "Tenant", user: "User") -> dict[str, Decimal]:
    """Tenant-wide current quantity totals and permission-safe valuation.

    Totals come from the current ``StockLevel`` projection, rather than from
    historical OPENING movements, so sales, purchases, returns, write-offs,
    counts, and transfers are all reflected. ``avg_cost`` is not referenced in
    the query at all unless the user may view cost.
    """
    quantity_field = models.DecimalField(max_digits=24, decimal_places=3)
    aggregates: dict[str, Any] = {
        "total_qty_on_hand": Sum("qty_on_hand", default=Decimal("0"), output_field=quantity_field),
        "total_qty_reserved": Sum(
            "qty_reserved", default=Decimal("0"), output_field=quantity_field
        ),
    }
    can_view_cost = user.has_perm("pricing.view_cost")
    if can_view_cost:
        valuation_field = models.DecimalField(max_digits=30, decimal_places=5)
        aggregates["stock_value"] = Sum(
            models.ExpressionWrapper(
                F("qty_on_hand") * F("avg_cost"), output_field=valuation_field
            ),
            default=Decimal("0"),
            output_field=valuation_field,
        )

    totals = StockLevel.objects.filter(tenant=tenant).aggregate(**aggregates)
    on_hand = totals["total_qty_on_hand"] or Decimal("0")
    reserved = totals["total_qty_reserved"] or Decimal("0")
    result = {
        "total_qty_on_hand": on_hand,
        "total_qty_reserved": reserved,
        "total_qty_available": on_hand - reserved,
    }
    if can_view_cost:
        result["stock_value"] = quantize_money(totals["stock_value"] or Decimal("0"))
    return result


def list_levels(
    tenant: "Tenant",
    user: "User",
    *,
    branch_id: UUID | None = None,
    variant_id: UUID | None = None,
    item_id: UUID | None = None,
    search: str = "",
) -> QuerySet[StockLevel]:
    """Stock levels with branch/variant/item filters and name/SKU search.

    Annotates ``reorder_level`` and ``is_low`` (on hand ≤ threshold) from
    ``item.reorder_level`` — the same source of truth the low-stock report
    uses — so the UI flags low rows without a per-row query.
    """
    qs = (
        StockLevel.objects.filter(tenant=tenant)
        .select_related("branch", "variant", "variant__item")
        .annotate(
            reorder_level=F("variant__item__reorder_level"),
            is_low=models.Case(
                models.When(
                    variant__item__reorder_level__isnull=False,
                    qty_on_hand__lte=F("variant__item__reorder_level"),
                    then=models.Value(True),
                ),
                default=models.Value(False),
                output_field=models.BooleanField(),
            ),
        )
    )
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    if variant_id:
        qs = qs.filter(variant_id=variant_id)
    if item_id:
        qs = qs.filter(variant__item_id=item_id)
    if search:
        qs = (
            qs.filter(variant__sku__icontains=search)
            | qs.filter(variant__item__name__icontains=search)
        ).distinct()
    if not user.has_perm("pricing.view_cost"):
        qs = qs.defer("avg_cost")
    return qs.order_by("variant__sku", "branch__code")


def list_movements(
    tenant: "Tenant",
    user: "User",
    *,
    branch_id: UUID | None = None,
    variant_id: UUID | None = None,
    movement_type: str = "",
    date_from: date | None = None,
    date_to: date | None = None,
) -> QuerySet[StockMovement]:
    """The ledger. Date filters are AD ISO in; BS fields are denormalized out."""
    qs = StockMovement.objects.filter(tenant=tenant).select_related(
        "branch", "variant", "variant__item", "created_by"
    )
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    if variant_id:
        qs = qs.filter(variant_id=variant_id)
    if movement_type:
        qs = qs.filter(type=movement_type)
    if date_from:
        qs = qs.filter(business_date_ad__gte=date_from)
    if date_to:
        qs = qs.filter(business_date_ad__lte=date_to)
    if not user.has_perm("pricing.view_cost"):
        qs = qs.defer("unit_cost")
    return qs.order_by("-created_at")


def list_transfers(
    tenant: "Tenant",
    user: "User",
    *,
    status: str = "",
    branch_id: "UUID | None" = None,
) -> "QuerySet[StockTransfer]":
    qs = StockTransfer.objects.filter(tenant=tenant).select_related(
        "from_branch", "to_branch", "created_by"
    )
    if status:
        qs = qs.filter(status=status)
    if branch_id:
        qs = qs.filter(models.Q(from_branch_id=branch_id) | models.Q(to_branch_id=branch_id))
    return qs.order_by("-created_at")


def get_transfer(tenant: "Tenant", user: "User", pk: "UUID") -> "StockTransfer | None":
    return (
        StockTransfer.objects.filter(tenant=tenant, pk=pk)
        .select_related("from_branch", "to_branch", "created_by")
        .prefetch_related("items__variant__item")
        .first()
    )


def in_transit(tenant: "Tenant", *, branch_id: "UUID | None" = None) -> list[dict[str, Any]]:
    """Stock between branches right now: Σ(qty_sent − qty_received) over
    SENT transfers, per variant (see StockTransfer's in-transit model)."""
    qs = StockTransferItem.objects.filter(tenant=tenant, transfer__status=StockTransfer.Status.SENT)
    if branch_id:
        qs = qs.filter(transfer__from_branch_id=branch_id)
    rows = (
        qs.values("variant_id", "variant__sku", "variant__item__name")
        .annotate(in_transit=Sum(F("qty_sent") - Coalesce(F("qty_received"), Decimal("0"))))
        .order_by("variant__sku")
    )
    return [
        {
            "variant_id": str(row["variant_id"]),
            "sku": row["variant__sku"],
            "item_name": row["variant__item__name"],
            "qty_in_transit": str(row["in_transit"]),
        }
        for row in rows
    ]


def list_counts(
    tenant: "Tenant",
    user: "User",
    *,
    status: str = "",
    branch_id: "UUID | None" = None,
) -> "QuerySet[StockCount]":
    qs = StockCount.objects.filter(tenant=tenant).select_related("branch", "created_by")
    if status:
        qs = qs.filter(status=status)
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    return qs.order_by("-started_at")


def get_count(tenant: "Tenant", user: "User", pk: "UUID") -> "StockCount | None":
    return (
        StockCount.objects.filter(tenant=tenant, pk=pk)
        .select_related("branch", "created_by")
        .prefetch_related("items__variant__item")
        .first()
    )
