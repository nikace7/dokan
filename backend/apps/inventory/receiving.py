"""Stock-in services that maintain the moving weighted-average projection."""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from apps.inventory.models import StockLevel, StockMovement
from apps.inventory.services import _lock_level, _write_movement
from core.money import quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.catalog.models import ItemVariant
    from apps.tenants.models import Branch, Tenant

_ZERO = Decimal("0")


def apply_stock_in(
    tenant: "Tenant",
    branch: "Branch",
    variant: "ItemVariant",
    qty: Decimal,
    unit_cost: Decimal,
    *,
    update_variant_cost: bool = True,
) -> tuple[StockLevel, Decimal]:
    """Add stock and fold cost into the branch's moving weighted average."""
    level = _lock_level(tenant, branch, variant)
    old_qty, old_avg = level.qty_on_hand, level.avg_cost
    new_qty = old_qty + qty
    new_avg = quantize_money((old_qty * old_avg + qty * unit_cost) / new_qty)
    level.qty_on_hand = new_qty
    level.avg_cost = new_avg
    level.save(update_fields=["qty_on_hand", "avg_cost", "updated_at"])

    if update_variant_cost:
        variant.avg_cost = new_avg
        variant.save(update_fields=["avg_cost", "updated_at"])
    return level, new_avg


def post_purchase_movement(
    tenant: "Tenant",
    *,
    branch: "Branch",
    variant: "ItemVariant",
    qty: Decimal,
    unit_cost: Decimal,
    created_by: "User",
    ref_type: str,
    ref_id: UUID,
    note: str = "",
    business_date: date | None = None,
) -> StockMovement:
    """Receive a purchase line at landed cost and update average cost."""
    qty = Decimal(qty)
    unit_cost = Decimal(unit_cost)
    if qty <= _ZERO:
        raise ServiceError("QTY_INVALID", "Purchase quantity must be greater than zero.")
    if unit_cost < _ZERO:
        raise ServiceError("COST_INVALID", "Unit cost cannot be negative.")
    level, _new_avg = apply_stock_in(tenant, branch, variant, qty, unit_cost)
    return _write_movement(
        tenant,
        branch=branch,
        variant=variant,
        movement_type=StockMovement.MovementType.PURCHASE,
        qty_delta=qty,
        unit_cost=quantize_money(unit_cost),
        balance_after=level.qty_on_hand,
        created_by=created_by,
        note=note,
        business_date=business_date,
        ref_type=ref_type,
        ref_id=ref_id,
    )
