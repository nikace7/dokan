"""Stock transfer services — one transaction per transition.

Lifecycle: DRAFT → (send) → SENT → (receive, possibly partial, many
times) → (complete) → RECEIVED. CANCELLED only from DRAFT — a sent
transfer must be completed (shortage handled), never cancelled
(documented rule).

Cost basis (documented): TRANSFER_OUT at source carries the source's
avg_cost at send time, snapshotted on the item's unit_cost column.
TRANSFER_IN at destination folds in at EXACTLY that basis via
_apply_stock_in(update_variant_cost=False) — the destination BRANCH's
average folds normally, but the tenant-wide variant.avg_cost is
untouched (the stock didn't change cost by moving).

Shortage handling (documented): at complete, any unreceived qty
(qty_sent − qty_received) is written off with a DAMAGE ledger row at the
SOURCE with qty_delta = 0 and balance_after = the current source level —
an annotation only, because the source already lost the stock at SEND;
a further decrement would double-count the loss.
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.utils import timezone

from apps.inventory.models import StockLevel, StockMovement, StockTransfer, StockTransferItem
from apps.inventory.services import _apply_stock_in, _lock_level, _write_movement
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_ZERO = Decimal("0")


def create_transfer(
    tenant: "Tenant",
    *,
    from_branch: Any,
    to_branch: Any,
    lines: list[dict[str, Any]],
    note: str,
    created_by: "User",
) -> StockTransfer:
    """Create a DRAFT transfer with its lines."""
    if from_branch.pk == to_branch.pk:
        raise ServiceError("TRANSFER_SAME_BRANCH", "Source and destination branches must differ.")
    if not lines:
        raise ServiceError("LINES_REQUIRED", "A transfer needs at least one line.")
    for line in lines:
        if Decimal(line["qty"]) <= _ZERO:
            raise ServiceError("QTY_INVALID", "Line quantity must be greater than zero.")
    with transaction.atomic():
        transfer = StockTransfer(
            tenant=tenant,
            from_branch=from_branch,
            to_branch=to_branch,
            created_by=created_by,
            note=note or None,
        )
        transfer.save()
        StockTransferItem.objects.bulk_create(
            [
                StockTransferItem(
                    tenant=tenant,
                    transfer=transfer,
                    variant=line["variant"],
                    qty_sent=Decimal(line["qty"]),
                )
                for line in lines
            ]
        )
    return transfer


def _assert_status(transfer: StockTransfer, expected: str, action: str) -> None:
    if transfer.status != expected:
        raise ServiceError(
            "TRANSFER_STATE_INVALID",
            f"Only {expected.lower()} transfers can be {action}.",
            http_status=409,
        )


def send_transfer(
    tenant: "Tenant", *, transfer: StockTransfer, created_by: "User"
) -> StockTransfer:
    """Post TRANSFER_OUT per line at source (zero-floor guard), set SENT,
    and snapshot each line's unit_cost at the source's avg_cost."""
    _assert_status(transfer, StockTransfer.Status.DRAFT, "sent")
    with transaction.atomic():
        for item in transfer.items.select_related("variant"):
            level = _lock_level(tenant, transfer.from_branch, item.variant)
            new_qty = level.qty_on_hand - item.qty_sent
            if new_qty < _ZERO:
                raise ServiceError(
                    "STOCK_INSUFFICIENT",
                    f"Only {level.qty_on_hand} of {item.variant.sku} at "
                    f"{transfer.from_branch.code}.",
                )
            item.unit_cost = level.avg_cost
            item.save(update_fields=["unit_cost"])
            level.qty_on_hand = new_qty
            level.save(update_fields=["qty_on_hand", "updated_at"])
            _write_movement(
                tenant,
                branch=transfer.from_branch,
                variant=item.variant,
                movement_type=StockMovement.MovementType.TRANSFER_OUT,
                qty_delta=-item.qty_sent,
                unit_cost=item.unit_cost,
                balance_after=new_qty,
                created_by=created_by,
                note=f"Transfer to {transfer.to_branch.code}",
                business_date=None,
                ref_type="stock_transfer",
                ref_id=transfer.pk,
            )
        transfer.status = StockTransfer.Status.SENT
        transfer.sent_at = timezone.now()
        transfer.save(update_fields=["status", "sent_at", "updated_at"])
    return transfer


def receive_transfer(
    tenant: "Tenant",
    *,
    transfer: StockTransfer,
    receipts: list[dict[str, Any]],
    created_by: "User",
) -> StockTransfer:
    """Post TRANSFER_IN at destination for received quantities (partial
    allowed — call repeatedly). Cumulative received per line must not
    exceed qty_sent."""
    _assert_status(transfer, StockTransfer.Status.SENT, "received")
    if not receipts:
        raise ServiceError("LINES_REQUIRED", "Provide at least one received line.")
    items_by_variant = {item.variant_id: item for item in transfer.items.all()}
    with transaction.atomic():
        for receipt in receipts:
            qty = Decimal(receipt["qty"])
            if qty <= _ZERO:
                raise ServiceError("QTY_INVALID", "Received quantity must be greater than zero.")
            item = items_by_variant.get(receipt["variant"].pk)
            if item is None:
                raise ServiceError(
                    "TRANSFER_LINE_UNKNOWN",
                    f"{receipt['variant'].sku} is not on this transfer.",
                )
            already = item.qty_received or _ZERO
            if already + qty > item.qty_sent:
                raise ServiceError(
                    "OVER_RECEIVE",
                    f"Only {item.qty_sent - already} of {item.variant.sku} is still in transit.",
                )
            _apply_stock_in(
                tenant,
                transfer.to_branch,
                item.variant,
                qty,
                item.unit_cost if item.unit_cost is not None else _ZERO,
                update_variant_cost=False,  # same cost basis — see module docstring
            )
            level = StockLevel.objects.get(branch=transfer.to_branch, variant=item.variant)
            _write_movement(
                tenant,
                branch=transfer.to_branch,
                variant=item.variant,
                movement_type=StockMovement.MovementType.TRANSFER_IN,
                qty_delta=qty,
                unit_cost=item.unit_cost,
                balance_after=level.qty_on_hand,
                created_by=created_by,
                note=f"Transfer from {transfer.from_branch.code}",
                business_date=None,
                ref_type="stock_transfer",
                ref_id=transfer.pk,
            )
            item.qty_received = already + qty
            item.save(update_fields=["qty_received"])
        if transfer.received_at is None:
            transfer.received_at = timezone.now()
            transfer.save(update_fields=["received_at", "updated_at"])
    return transfer


def complete_transfer(
    tenant: "Tenant", *, transfer: StockTransfer, created_by: "User"
) -> StockTransfer:
    """Close a SENT transfer. Shortage per line (sent − received) is
    written off with a zero-delta DAMAGE annotation at source (documented
    in the module docstring — no double-count)."""
    _assert_status(transfer, StockTransfer.Status.SENT, "completed")
    with transaction.atomic():
        for item in transfer.items.select_related("variant"):
            received = item.qty_received or _ZERO
            shortage = item.qty_sent - received
            if shortage <= _ZERO:
                continue
            level = _lock_level(tenant, transfer.from_branch, item.variant)
            _write_movement(
                tenant,
                branch=transfer.from_branch,
                variant=item.variant,
                movement_type=StockMovement.MovementType.DAMAGE,
                qty_delta=_ZERO,  # annotation only — source lost the stock at SEND
                unit_cost=item.unit_cost,
                balance_after=level.qty_on_hand,
                created_by=created_by,
                note=(
                    f"Transfer shortage: sent {item.qty_sent}, "
                    f"received {received} at {transfer.to_branch.code}"
                ),
                business_date=None,
                ref_type="stock_transfer",
                ref_id=transfer.pk,
            )
        transfer.status = StockTransfer.Status.RECEIVED
        if transfer.received_at is None:
            transfer.received_at = timezone.now()
        transfer.save(update_fields=["status", "received_at", "updated_at"])
    return transfer


def cancel_transfer(tenant: "Tenant", *, transfer: StockTransfer) -> StockTransfer:
    """Void a DRAFT. SENT transfers complete or partially receive instead."""
    _assert_status(transfer, StockTransfer.Status.DRAFT, "cancelled")
    transfer.status = StockTransfer.Status.CANCELLED
    transfer.save(update_fields=["status", "updated_at"])
    return transfer
