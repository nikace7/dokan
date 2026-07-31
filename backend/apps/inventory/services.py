"""Write-side business logic for inventory — one service function, one transaction.

Invariant #1: every stock mutation goes through here — a ledger row in
``stock_movement`` plus the ``stock_level`` projection update in the SAME
transaction. Mutations serialize per (branch, variant) with
``SELECT ... FOR UPDATE`` on the projection row so concurrent postings
cannot corrupt ``balance_after`` or the moving weighted average.

Business dates are denormalized at write time (design §6.1):
``business_date_ad`` is the Kathmandu operating date; ``business_date_bs``
and ``fiscal_year_bs`` come only from core/calendar/bs.py.
"""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.inventory.models import StockLevel, StockMovement
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.catalog.models import ItemVariant
    from apps.tenants.models import Branch, Tenant

_ZERO = Decimal("0")


def _lock_level(tenant: "Tenant", branch: "Branch", variant: "ItemVariant") -> StockLevel:
    """Return the projection row for (branch, variant), locked FOR UPDATE.

    Creates the row when missing; the unique (branch, variant) constraint
    plus a savepoint retry makes the create race-safe.
    """
    level = (
        StockLevel.objects.select_for_update()
        .filter(tenant=tenant, branch=branch, variant=variant)
        .first()
    )
    if level is not None:
        return level
    try:
        with transaction.atomic():  # savepoint: contains the race's IntegrityError
            level = StockLevel.objects.create(tenant=tenant, branch=branch, variant=variant)
    except IntegrityError:
        level = StockLevel.objects.select_for_update().get(
            tenant=tenant, branch=branch, variant=variant
        )
    return level


def _business_dates(business_date: date | None) -> tuple[date, str, str]:
    """Denormalize the business date triplet at write time."""
    ad = business_date or timezone.localdate()
    return ad, ad_to_bs(ad), fiscal_year_bs(ad)


def _write_movement(
    tenant: "Tenant",
    *,
    branch: "Branch",
    variant: "ItemVariant",
    movement_type: str,
    qty_delta: Decimal,
    unit_cost: Decimal | None,
    balance_after: Decimal,
    created_by: "User",
    note: str,
    business_date: date | None,
    ref_type: str = "",
    ref_id: "UUID | None" = None,
) -> StockMovement:
    """Append one ledger row with its denormalized business dates."""
    date_ad, date_bs, fy_bs = _business_dates(business_date)
    return StockMovement.objects.create(
        tenant=tenant,
        branch=branch,
        variant=variant,
        type=movement_type,
        qty_delta=qty_delta,
        unit_cost=unit_cost,
        balance_after=balance_after,
        ref_type=ref_type or None,
        ref_id=ref_id,
        note=note or None,
        business_date_ad=date_ad,
        business_date_bs=date_bs,
        fiscal_year_bs=fy_bs,
        created_by=created_by,
    )


def post_sale_movement(
    tenant: "Tenant",
    *,
    branch: "Branch",
    variant: "ItemVariant",
    qty: Decimal,
    created_by: "User",
    ref_type: str,
    ref_id: "UUID",
    note: str = "",
    business_date: date | None = None,
) -> StockMovement:
    """Decrement stock for a sale line (SALE movement).

    MUST be called inside the caller's transaction — the sale service owns
    it, so a failed sale rolls the movements back with everything else.
    Stock must never go below zero; avg_cost is untouched by sales.
    ``unit_cost`` snapshots the branch average cost at movement time.
    """
    qty = Decimal(qty)
    if qty <= _ZERO:
        raise ServiceError("QTY_INVALID", "Sale quantity must be greater than zero.")
    level = _lock_level(tenant, branch, variant)
    new_qty = level.qty_on_hand - qty
    if new_qty < _ZERO:
        raise ServiceError(
            "STOCK_INSUFFICIENT",
            f"Only {level.qty_on_hand} of {variant.sku} in stock.",
        )
    unit_cost = level.avg_cost
    level.qty_on_hand = new_qty
    level.save(update_fields=["qty_on_hand", "updated_at"])
    return _write_movement(
        tenant,
        branch=branch,
        variant=variant,
        movement_type=StockMovement.MovementType.SALE,
        qty_delta=-qty,
        unit_cost=unit_cost,
        balance_after=new_qty,
        created_by=created_by,
        note=note,
        business_date=business_date,
        ref_type=ref_type,
        ref_id=ref_id,
    )


def post_opening_stock(
    tenant: "Tenant",
    *,
    branch: "Branch",
    variant: "ItemVariant",
    qty: Decimal,
    unit_cost: Decimal,
    created_by: "User",
    note: str = "",
    business_date: date | None = None,
) -> StockMovement:
    """Post OPENING stock and fold it into the moving weighted average.

    new_avg = (old_qty × old_avg + in_qty × cost) / (old_qty + in_qty)
    The variant's avg_cost is updated in the same transaction — inventory
    owns that column; catalog endpoints never write it.
    """
    qty = Decimal(qty)
    unit_cost = Decimal(unit_cost)
    if qty <= _ZERO:
        raise ServiceError("QTY_INVALID", "Opening quantity must be greater than zero.")
    if unit_cost < _ZERO:
        raise ServiceError("COST_INVALID", "Unit cost cannot be negative.")

    with transaction.atomic():
        level = _lock_level(tenant, branch, variant)
        old_qty, old_avg = level.qty_on_hand, level.avg_cost
        new_qty = old_qty + qty
        new_avg = quantize_money((old_qty * old_avg + qty * unit_cost) / new_qty)

        level.qty_on_hand = new_qty
        level.avg_cost = new_avg
        level.save(update_fields=["qty_on_hand", "avg_cost", "updated_at"])

        variant.avg_cost = new_avg
        variant.save(update_fields=["avg_cost", "updated_at"])

        return _write_movement(
            tenant,
            branch=branch,
            variant=variant,
            movement_type=StockMovement.MovementType.OPENING,
            qty_delta=qty,
            unit_cost=unit_cost,
            balance_after=new_qty,
            created_by=created_by,
            note=note,
            business_date=business_date,
        )


def adjust_stock(
    tenant: "Tenant",
    *,
    branch: "Branch",
    variant: "ItemVariant",
    qty_delta: Decimal,
    reason: str,
    created_by: "User",
    business_date: date | None = None,
) -> StockMovement:
    """Post an ADJUSTMENT (signed). Stock must never go below zero.

    avg_cost is untouched: an adjustment carries no cost information.
    """
    qty_delta = Decimal(qty_delta)
    if qty_delta == _ZERO:
        raise ServiceError("QTY_INVALID", "Adjustment quantity cannot be zero.")
    if not reason.strip():
        raise ServiceError("REASON_REQUIRED", "A reason is required for stock adjustments.")

    with transaction.atomic():
        level = _lock_level(tenant, branch, variant)
        new_qty = level.qty_on_hand + qty_delta
        if new_qty < _ZERO:
            raise ServiceError(
                "STOCK_INSUFFICIENT",
                f"Only {level.qty_on_hand} in stock; cannot adjust by {qty_delta}.",
            )
        level.qty_on_hand = new_qty
        level.save(update_fields=["qty_on_hand", "updated_at"])

        return _write_movement(
            tenant,
            branch=branch,
            variant=variant,
            movement_type=StockMovement.MovementType.ADJUSTMENT,
            qty_delta=qty_delta,
            unit_cost=None,
            balance_after=new_qty,
            created_by=created_by,
            note=reason,
            business_date=business_date,
        )


def write_off_damage(
    tenant: "Tenant",
    *,
    branch: "Branch",
    variant: "ItemVariant",
    qty: Decimal,
    reason: str,
    created_by: "User",
    business_date: date | None = None,
) -> StockMovement:
    """Post a DAMAGE write-off (qty > 0 removes stock). Same zero-floor guard."""
    qty = Decimal(qty)
    if qty <= _ZERO:
        raise ServiceError("QTY_INVALID", "Write-off quantity must be greater than zero.")
    if not reason.strip():
        raise ServiceError("REASON_REQUIRED", "A reason is required for damage write-offs.")

    with transaction.atomic():
        level = _lock_level(tenant, branch, variant)
        new_qty = level.qty_on_hand - qty
        if new_qty < _ZERO:
            raise ServiceError(
                "STOCK_INSUFFICIENT",
                f"Only {level.qty_on_hand} in stock; cannot write off {qty}.",
            )
        level.qty_on_hand = new_qty
        level.save(update_fields=["qty_on_hand", "updated_at"])

        return _write_movement(
            tenant,
            branch=branch,
            variant=variant,
            movement_type=StockMovement.MovementType.DAMAGE,
            qty_delta=-qty,
            unit_cost=None,
            balance_after=new_qty,
            created_by=created_by,
            note=reason,
            business_date=business_date,
        )


def post_sale_return_movement(
    tenant: "Tenant",
    *,
    branch: "Branch",
    variant: "ItemVariant",
    qty: Decimal,
    unit_cost: Decimal,
    created_by: "User",
    ref_type: str,
    ref_id: "UUID",
    note: str = "",
    business_date: date | None = None,
) -> StockMovement:
    """Return stock from a sale (SALE_RETURN movement) at the ORIGINAL cost.

    MUST be called inside the caller's transaction — the return/exchange
    service owns it. Stock comes back in at the sale-time cost
    (cost_at_sale), so the moving weighted average is mathematically
    undisturbed: never recomputed here (invariant 2).
    """
    qty = Decimal(qty)
    if qty <= _ZERO:
        raise ServiceError("QTY_INVALID", "Return quantity must be greater than zero.")
    level = _lock_level(tenant, branch, variant)
    new_qty = level.qty_on_hand + qty
    level.qty_on_hand = new_qty
    level.save(update_fields=["qty_on_hand", "updated_at"])
    return _write_movement(
        tenant,
        branch=branch,
        variant=variant,
        movement_type=StockMovement.MovementType.SALE_RETURN,
        qty_delta=qty,
        unit_cost=quantize_money(unit_cost),
        balance_after=new_qty,
        created_by=created_by,
        note=note,
        business_date=business_date,
        ref_type=ref_type,
        ref_id=ref_id,
    )


def _apply_stock_in(
    tenant: "Tenant",
    branch: "Branch",
    variant: "ItemVariant",
    qty: Decimal,
    unit_cost: Decimal,
) -> tuple[StockLevel, Decimal]:
    """Lock the level, add qty, fold cost into the moving weighted average.

    Shared by OPENING and PURCHASE postings. MUST run inside the caller's
    transaction. Returns (level, new_avg_cost).
    """
    level = _lock_level(tenant, branch, variant)
    old_qty, old_avg = level.qty_on_hand, level.avg_cost
    new_qty = old_qty + qty
    new_avg = quantize_money((old_qty * old_avg + qty * unit_cost) / new_qty)
    level.qty_on_hand = new_qty
    level.avg_cost = new_avg
    level.save(update_fields=["qty_on_hand", "avg_cost", "updated_at"])

    variant.avg_cost = new_avg  # inventory owns this column
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
    ref_id: "UUID",
    note: str = "",
    business_date: date | None = None,
) -> StockMovement:
    """Receive stock from a purchase line (PURCHASE movement).

    MUST be called inside the caller's transaction — the purchase-confirm
    pipeline owns it. ``unit_cost`` is the LANDED unit cost (line cost plus
    allocated other charges) so the moving weighted average reflects true
    cost. Updates variant.avg_cost in the same transaction.
    """
    qty = Decimal(qty)
    unit_cost = Decimal(unit_cost)
    if qty <= _ZERO:
        raise ServiceError("QTY_INVALID", "Purchase quantity must be greater than zero.")
    if unit_cost < _ZERO:
        raise ServiceError("COST_INVALID", "Unit cost cannot be negative.")
    level, _new_avg = _apply_stock_in(tenant, branch, variant, qty, unit_cost)
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
