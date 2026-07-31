"""Stock transfer tests — lifecycle, cost basis, shortage, in-transit
invariant, and every state guard.
"""

from decimal import Decimal
from typing import Any

import pytest

from apps.inventory import transfers
from apps.inventory.models import StockLevel, StockMovement, StockTransfer
from apps.inventory.selectors import in_transit
from apps.inventory.services import post_opening_stock
from core.responses import ServiceError
from tests.factories import (
    BranchFactory,
    ItemVariantFactory,
    TenantFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def shop() -> dict[str, Any]:
    tenant = TenantFactory()
    user = UserFactory(tenant=tenant)
    branch_a = BranchFactory(tenant=tenant, code="MAIN")
    branch_b = BranchFactory(tenant=tenant, code="OUTLET")
    variant = ItemVariantFactory(tenant=tenant)
    post_opening_stock(
        tenant,
        branch=branch_a,
        variant=variant,
        qty=Decimal("10"),
        unit_cost=Decimal("500.00"),
        created_by=user,
    )
    return {
        "tenant": tenant,
        "user": user,
        "branch_a": branch_a,
        "branch_b": branch_b,
        "variant": variant,
    }


def _level(shop: dict, branch: Any) -> Any:
    return StockLevel.objects.get(branch=branch, variant=shop["variant"])


def _transfer(shop: dict, qty: str = "4") -> Any:
    return transfers.create_transfer(
        shop["tenant"],
        from_branch=shop["branch_a"],
        to_branch=shop["branch_b"],
        lines=[{"variant": shop["variant"], "qty": Decimal(qty)}],
        note="Rebalance",
        created_by=shop["user"],
    )


class TestLifecycle:
    def test_full_flow_with_shortage(self, shop: dict) -> None:
        transfer = _transfer(shop, "4")
        transfers.send_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])

        # Source decremented at its avg_cost; line snapshot carries the basis.
        assert _level(shop, shop["branch_a"]).qty_on_hand == Decimal("6")
        item = transfer.items.get()
        assert item.unit_cost == Decimal("500.00")
        out = StockMovement.objects.get(type=StockMovement.MovementType.TRANSFER_OUT)
        assert out.unit_cost == Decimal("500.00")
        assert out.balance_after == Decimal("6")
        assert transfer.status == StockTransfer.Status.SENT
        assert in_transit(shop["tenant"])[0]["qty_in_transit"] == "4.000"

        # Partial receive, twice.
        transfers.receive_transfer(
            shop["tenant"],
            transfer=transfer,
            receipts=[{"variant": shop["variant"], "qty": Decimal("1")}],
            created_by=shop["user"],
        )
        transfers.receive_transfer(
            shop["tenant"],
            transfer=transfer,
            receipts=[{"variant": shop["variant"], "qty": Decimal("2")}],
            created_by=shop["user"],
        )
        level_b = _level(shop, shop["branch_b"])
        assert level_b.qty_on_hand == Decimal("3")
        assert level_b.avg_cost == Decimal("500.00")  # folded at the source basis

        shop["variant"].refresh_from_db()
        assert shop["variant"].avg_cost == Decimal("500.00")  # tenant avg untouched

        # In-transit invariant: A + B + in-transit == initial stock.
        transit = in_transit(shop["tenant"])[0]
        assert transit["qty_in_transit"] == "1.000"
        assert Decimal("6") + Decimal("3") + Decimal(transit["qty_in_transit"]) == Decimal("10")

        # Complete: shortage of 1 written off as a zero-delta DAMAGE annotation.
        transfers.complete_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])
        assert transfer.status == StockTransfer.Status.RECEIVED
        damage = StockMovement.objects.get(type=StockMovement.MovementType.DAMAGE)
        assert damage.qty_delta == Decimal("0")
        assert damage.balance_after == Decimal("6")  # NO double-decrement
        assert damage.note is not None and "shortage" in damage.note
        assert in_transit(shop["tenant"]) == []

    def test_full_receive_leaves_no_annotation(self, shop: dict) -> None:
        transfer = _transfer(shop, "2")
        transfers.send_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])
        transfers.receive_transfer(
            shop["tenant"],
            transfer=transfer,
            receipts=[{"variant": shop["variant"], "qty": Decimal("2")}],
            created_by=shop["user"],
        )
        transfers.complete_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])
        assert StockMovement.objects.filter(type=StockMovement.MovementType.DAMAGE).count() == 0


class TestGuards:
    def test_same_branch_rejected(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            transfers.create_transfer(
                shop["tenant"],
                from_branch=shop["branch_a"],
                to_branch=shop["branch_a"],
                lines=[{"variant": shop["variant"], "qty": Decimal("1")}],
                note="",
                created_by=shop["user"],
            )
        assert exc.value.code == "TRANSFER_SAME_BRANCH"

    def test_zero_floor_at_send(self, shop: dict) -> None:
        transfer = _transfer(shop, "99")
        with pytest.raises(ServiceError) as exc:
            transfers.send_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])
        assert exc.value.code == "STOCK_INSUFFICIENT"
        assert _level(shop, shop["branch_a"]).qty_on_hand == Decimal("10")

    def test_over_receive_rejected(self, shop: dict) -> None:
        transfer = _transfer(shop, "2")
        transfers.send_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            transfers.receive_transfer(
                shop["tenant"],
                transfer=transfer,
                receipts=[{"variant": shop["variant"], "qty": Decimal("3")}],
                created_by=shop["user"],
            )
        assert exc.value.code == "OVER_RECEIVE"

    def test_unknown_variant_at_receive_rejected(self, shop: dict) -> None:
        transfer = _transfer(shop, "1")
        transfers.send_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])
        other = ItemVariantFactory(tenant=shop["tenant"])
        with pytest.raises(ServiceError) as exc:
            transfers.receive_transfer(
                shop["tenant"],
                transfer=transfer,
                receipts=[{"variant": other, "qty": Decimal("1")}],
                created_by=shop["user"],
            )
        assert exc.value.code == "TRANSFER_LINE_UNKNOWN"

    def test_receive_on_draft_is_409(self, shop: dict) -> None:
        transfer = _transfer(shop, "1")
        with pytest.raises(ServiceError) as exc:
            transfers.receive_transfer(
                shop["tenant"],
                transfer=transfer,
                receipts=[{"variant": shop["variant"], "qty": Decimal("1")}],
                created_by=shop["user"],
            )
        assert exc.value.code == "TRANSFER_STATE_INVALID"

    def test_cancel_only_from_draft(self, shop: dict) -> None:
        transfer = _transfer(shop, "1")
        cancelled = transfers.cancel_transfer(shop["tenant"], transfer=transfer)
        assert cancelled.status == StockTransfer.Status.CANCELLED

        sent = _transfer(shop, "1")
        transfers.send_transfer(shop["tenant"], transfer=sent, created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            transfers.cancel_transfer(shop["tenant"], transfer=sent)
        assert exc.value.code == "TRANSFER_STATE_INVALID"

    def test_complete_on_draft_is_409(self, shop: dict) -> None:
        transfer = _transfer(shop, "1")
        with pytest.raises(ServiceError) as exc:
            transfers.complete_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])
        assert exc.value.code == "TRANSFER_STATE_INVALID"

    def test_line_validation(self, shop: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            transfers.create_transfer(
                shop["tenant"],
                from_branch=shop["branch_a"],
                to_branch=shop["branch_b"],
                lines=[],
                note="",
                created_by=shop["user"],
            )
        assert exc.value.code == "LINES_REQUIRED"
        with pytest.raises(ServiceError) as exc:
            transfers.create_transfer(
                shop["tenant"],
                from_branch=shop["branch_a"],
                to_branch=shop["branch_b"],
                lines=[{"variant": shop["variant"], "qty": Decimal("0")}],
                note="",
                created_by=shop["user"],
            )
        assert exc.value.code == "QTY_INVALID"

    def test_receive_requires_lines(self, shop: dict) -> None:
        transfer = _transfer(shop, "1")
        transfers.send_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            transfers.receive_transfer(
                shop["tenant"], transfer=transfer, receipts=[], created_by=shop["user"]
            )
        assert exc.value.code == "LINES_REQUIRED"

    def test_receive_zero_qty_rejected(self, shop: dict) -> None:
        transfer = _transfer(shop, "1")
        transfers.send_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            transfers.receive_transfer(
                shop["tenant"],
                transfer=transfer,
                receipts=[{"variant": shop["variant"], "qty": Decimal("0")}],
                created_by=shop["user"],
            )
        assert exc.value.code == "QTY_INVALID"
