"""Rebuild the mutable stock projection from the immutable movement ledger."""

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from django.db import transaction

from apps.inventory.models import StockLevel, StockMovement, StockTransfer, StockTransferItem
from core.money import quantize_money

if TYPE_CHECKING:
    from apps.tenants.models import Tenant

_ZERO_QTY = Decimal("0.000")
_ZERO_COST = Decimal("0.00")
_COSTED_STOCK_IN = {
    StockMovement.MovementType.OPENING,
    StockMovement.MovementType.PURCHASE,
    StockMovement.MovementType.TRANSFER_IN,
}


@dataclass(frozen=True)
class StockDrift:
    branch_id: UUID
    variant_id: UUID
    actual_qty: Decimal
    expected_qty: Decimal
    actual_avg_cost: Decimal
    expected_avg_cost: Decimal
    projection_missing: bool = False


@dataclass(frozen=True)
class ReconciliationResult:
    levels_checked: int
    drifts: tuple[StockDrift, ...]
    in_transit_qty: Decimal


@dataclass
class _ExpectedLevel:
    qty_on_hand: Decimal = _ZERO_QTY
    avg_cost: Decimal = _ZERO_COST


def _expected_levels(tenant: "Tenant") -> dict[tuple[UUID, UUID], _ExpectedLevel]:
    expected: dict[tuple[UUID, UUID], _ExpectedLevel] = {}
    movements = (
        StockMovement.objects.filter(tenant=tenant)
        .order_by("branch_id", "variant_id", "created_at", "pk")
        .values_list("branch_id", "variant_id", "type", "qty_delta", "unit_cost")
    )
    for branch_id, variant_id, movement_type, qty_delta, unit_cost in movements.iterator():
        state = expected.setdefault((branch_id, variant_id), _ExpectedLevel())
        new_qty = state.qty_on_hand + qty_delta
        if movement_type in _COSTED_STOCK_IN and qty_delta > _ZERO_QTY and unit_cost is not None:
            state.avg_cost = quantize_money(
                (state.qty_on_hand * state.avg_cost + qty_delta * unit_cost) / new_qty
            )
        state.qty_on_hand = new_qty
    return expected


def _in_transit_qty(tenant: "Tenant") -> Decimal:
    quantities = StockTransferItem.objects.filter(
        tenant=tenant,
        transfer__status=StockTransfer.Status.SENT,
    ).values_list("qty_sent", "qty_received")
    return sum((sent - (received or _ZERO_QTY) for sent, received in quantities), _ZERO_QTY)


@transaction.atomic
def reconcile_stock_projection(tenant: "Tenant") -> ReconciliationResult:
    """Repair stock-level quantity/cost drift and report stock still in transit."""
    expected = _expected_levels(tenant)
    levels = list(StockLevel.objects.select_for_update().filter(tenant=tenant))
    drifts: list[StockDrift] = []

    for level in levels:
        state = expected.pop((level.branch_id, level.variant_id), _ExpectedLevel())
        if level.qty_on_hand == state.qty_on_hand and level.avg_cost == state.avg_cost:
            continue
        drifts.append(
            StockDrift(
                branch_id=level.branch_id,
                variant_id=level.variant_id,
                actual_qty=level.qty_on_hand,
                expected_qty=state.qty_on_hand,
                actual_avg_cost=level.avg_cost,
                expected_avg_cost=state.avg_cost,
            )
        )
        level.qty_on_hand = state.qty_on_hand
        level.avg_cost = state.avg_cost
        level.save(update_fields=["qty_on_hand", "avg_cost", "updated_at"])

    for (branch_id, variant_id), state in expected.items():
        StockLevel.objects.create(
            tenant=tenant,
            branch_id=branch_id,
            variant_id=variant_id,
            qty_on_hand=state.qty_on_hand,
            avg_cost=state.avg_cost,
        )
        drifts.append(
            StockDrift(
                branch_id=branch_id,
                variant_id=variant_id,
                actual_qty=_ZERO_QTY,
                expected_qty=state.qty_on_hand,
                actual_avg_cost=_ZERO_COST,
                expected_avg_cost=state.avg_cost,
                projection_missing=True,
            )
        )

    return ReconciliationResult(
        levels_checked=len(levels) + len(expected),
        drifts=tuple(drifts),
        in_transit_qty=_in_transit_qty(tenant),
    )
