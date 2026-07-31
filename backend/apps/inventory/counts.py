"""Physical count services — snapshot, record, finalize.

Lifecycle: OPEN → (record_counts, editable) → FINALIZED, or OPEN →
CANCELLED. system_qty is the snapshot at start and is NEVER rewritten —
the count compares the world as it was at start with what was counted.
Finalize posts one COUNT movement per line with a NON-ZERO variance
(qty_delta = variance, unit_cost = NULL, balance_after = counted) and
sets the level to the counted quantity. Zero-variance lines get no
movement — the ledger only records changes.
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any, cast

from django.db import transaction
from django.utils import timezone

from apps.inventory.models import StockCount, StockCountItem, StockLevel, StockMovement
from apps.inventory.services import _lock_level, _write_movement
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_ZERO = Decimal("0")


def start_count(tenant: "Tenant", *, branch: Any, created_by: "User") -> StockCount:
    """Open a count for a branch, snapshotting system_qty for every
    stocked variant (every stock_level row, including zero-quantity rows —
    a count can find stock the system thinks is gone)."""
    if StockCount.objects.filter(
        tenant=tenant, branch=branch, status=StockCount.Status.OPEN
    ).exists():
        raise ServiceError(
            "COUNT_ALREADY_OPEN",
            "This branch already has an open stock count.",
            http_status=409,
        )
    levels = list(StockLevel.objects.filter(tenant=tenant, branch=branch).select_related("variant"))
    if not levels:
        raise ServiceError("COUNT_EMPTY_BRANCH", "This branch has no stocked variants to count.")
    with transaction.atomic():
        count = StockCount(
            tenant=tenant,
            branch=branch,
            created_by=created_by,
            started_at=timezone.now(),
        )
        count.save()
        StockCountItem.objects.bulk_create(
            [
                StockCountItem(
                    tenant=tenant,
                    count=count,
                    variant=level.variant,
                    system_qty=level.qty_on_hand,
                )
                for level in levels
            ]
        )
    return count


def record_counts(
    tenant: "Tenant",
    *,
    count: StockCount,
    counts: list[dict[str, Any]],
) -> StockCount:
    """Fill counted_qty for lines; variance = counted − system (stored).

    Unknown variants are rejected — a variant found on the shelf that the
    branch has no level row for is a data problem to resolve first
    (documented; ad-hoc line adds come with the stock-taking UI slice).
    """
    if count.status != StockCount.Status.OPEN:
        raise ServiceError(
            "COUNT_STATE_INVALID", "Only open counts can be recorded.", http_status=409
        )
    if not counts:
        raise ServiceError("LINES_REQUIRED", "Provide at least one counted line.")
    items_by_variant = {item.variant_id: item for item in count.items.all()}
    with transaction.atomic():
        for entry in counts:
            counted = Decimal(entry["counted_qty"])
            if counted < _ZERO:
                raise ServiceError("COUNT_QTY_INVALID", "Counted quantity cannot be negative.")
            item = items_by_variant.get(entry["variant"].pk)
            if item is None:
                raise ServiceError(
                    "COUNT_VARIANT_UNKNOWN",
                    f"{entry['variant'].sku} is not on this count.",
                )
            item.counted_qty = counted
            item.variance = counted - item.system_qty
            item.note = entry.get("note") or None
            item.save(update_fields=["counted_qty", "variance", "note"])
    return count


def finalize_count(tenant: "Tenant", *, count: StockCount, created_by: "User") -> StockCount:
    """Post COUNT movements for non-zero variances and set levels to
    counted quantities — ONE transaction. All lines must be counted."""
    if count.status != StockCount.Status.OPEN:
        raise ServiceError(
            "COUNT_STATE_INVALID", "Only open counts can be finalized.", http_status=409
        )
    items = list(count.items.select_related("variant"))
    uncounted = [item for item in items if item.counted_qty is None]
    if uncounted:
        raise ServiceError(
            "COUNT_INCOMPLETE",
            f"{len(uncounted)} lines are not counted yet.",
        )
    with transaction.atomic():
        for item in items:
            variance = item.variance if item.variance is not None else _ZERO
            if variance == _ZERO:
                continue
            counted = cast(Decimal, item.counted_qty)  # guarded by COUNT_INCOMPLETE
            level = _lock_level(tenant, count.branch, item.variant)
            level.qty_on_hand = counted
            level.save(update_fields=["qty_on_hand", "updated_at"])
            _write_movement(
                tenant,
                branch=count.branch,
                variant=item.variant,
                movement_type=StockMovement.MovementType.COUNT,
                qty_delta=variance,
                unit_cost=None,
                balance_after=counted,
                created_by=created_by,
                note=item.note or "Physical count variance",
                business_date=None,
                ref_type="stock_count",
                ref_id=count.pk,
            )
        count.status = StockCount.Status.FINALIZED
        count.finalized_at = timezone.now()
        count.save(update_fields=["status", "finalized_at", "updated_at"])
    return count


def cancel_count(tenant: "Tenant", *, count: StockCount) -> StockCount:
    """Void an OPEN count — a status change, never a DELETE."""
    if count.status != StockCount.Status.OPEN:
        raise ServiceError(
            "COUNT_STATE_INVALID", "Only open counts can be cancelled.", http_status=409
        )
    count.status = StockCount.Status.CANCELLED
    count.save(update_fields=["status", "updated_at"])
    return count
