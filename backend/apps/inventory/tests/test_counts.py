"""Physical count tests — snapshot, variance math, finalize, state guards."""

from decimal import Decimal
from typing import Any

import pytest

from apps.inventory import counts
from apps.inventory.models import StockCount, StockLevel, StockMovement
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
    branch = BranchFactory(tenant=tenant)
    variant_a = ItemVariantFactory(tenant=tenant)
    variant_b = ItemVariantFactory(tenant=tenant)
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant_a,
        qty=Decimal("10"),
        unit_cost=Decimal("500.00"),
        created_by=user,
    )
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant_b,
        qty=Decimal("3"),
        unit_cost=Decimal("200.00"),
        created_by=user,
    )
    return {
        "tenant": tenant,
        "user": user,
        "branch": branch,
        "variant_a": variant_a,
        "variant_b": variant_b,
    }


def _record_all(shop: dict, count: Any, counts_list: list) -> Any:
    return counts.record_counts(shop["tenant"], count=count, counts=counts_list)


class TestStart:
    def test_start_snapshots_system_qty(self, shop: dict) -> None:
        count = counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        items = {item.variant_id: item for item in count.items.all()}
        assert items[shop["variant_a"].pk].system_qty == Decimal("10")
        assert items[shop["variant_b"].pk].system_qty == Decimal("3")
        assert items[shop["variant_a"].pk].counted_qty is None

    def test_second_open_count_is_409(self, shop: dict) -> None:
        counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        assert exc.value.code == "COUNT_ALREADY_OPEN"

    def test_empty_branch_rejected(self, shop: dict) -> None:
        empty = BranchFactory(tenant=shop["tenant"])
        with pytest.raises(ServiceError) as exc:
            counts.start_count(shop["tenant"], branch=empty, created_by=shop["user"])
        assert exc.value.code == "COUNT_EMPTY_BRANCH"


class TestRecord:
    def test_variance_computed_at_entry(self, shop: dict) -> None:
        count = counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        _record_all(
            shop,
            count,
            [
                {"variant": shop["variant_a"], "counted_qty": Decimal("8")},
                {"variant": shop["variant_b"], "counted_qty": Decimal("3")},
            ],
        )
        item_a = count.items.get(variant=shop["variant_a"])
        assert item_a.counted_qty == Decimal("8")
        assert item_a.variance == Decimal("-2")

    def test_unknown_variant_rejected(self, shop: dict) -> None:
        count = counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        other = ItemVariantFactory(tenant=shop["tenant"])
        with pytest.raises(ServiceError) as exc:
            _record_all(shop, count, [{"variant": other, "counted_qty": Decimal("1")}])
        assert exc.value.code == "COUNT_VARIANT_UNKNOWN"

    def test_negative_counted_rejected(self, shop: dict) -> None:
        count = counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            _record_all(shop, count, [{"variant": shop["variant_a"], "counted_qty": Decimal("-1")}])
        assert exc.value.code == "COUNT_QTY_INVALID"

    def test_record_requires_lines(self, shop: dict) -> None:
        count = counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            counts.record_counts(shop["tenant"], count=count, counts=[])
        assert exc.value.code == "LINES_REQUIRED"


def _finalize_ready(shop: dict) -> Any:
    count = counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
    _record_all(
        shop,
        count,
        [
            {"variant": shop["variant_a"], "counted_qty": Decimal("8")},
            {"variant": shop["variant_b"], "counted_qty": Decimal("3")},
        ],
    )
    return count


class TestFinalize:
    def _unused(self, shop: dict) -> Any:
        count = counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        _record_all(
            shop,
            count,
            [
                {"variant": shop["variant_a"], "counted_qty": Decimal("8")},
                {"variant": shop["variant_b"], "counted_qty": Decimal("3")},
            ],
        )
        return count

    def test_finalize_posts_only_nonzero_variance(self, shop: dict) -> None:
        count = _finalize_ready(shop)
        finalized = counts.finalize_count(shop["tenant"], count=count, created_by=shop["user"])
        assert finalized.status == StockCount.Status.FINALIZED

        movements = StockMovement.objects.filter(type=StockMovement.MovementType.COUNT)
        assert movements.count() == 1  # B had zero variance — no movement
        movement = movements.get()
        assert movement.variant_id == shop["variant_a"].pk
        assert movement.qty_delta == Decimal("-2")
        assert movement.unit_cost is None
        assert movement.balance_after == Decimal("8")

        level_a = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_a"])
        assert level_a.qty_on_hand == Decimal("8")
        level_b = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant_b"])
        assert level_b.qty_on_hand == Decimal("3")  # untouched

    def test_double_finalize_rejected(self, shop: dict) -> None:
        count = _finalize_ready(shop)
        counts.finalize_count(shop["tenant"], count=count, created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            counts.finalize_count(shop["tenant"], count=count, created_by=shop["user"])
        assert exc.value.code == "COUNT_STATE_INVALID"

    def test_finalize_incomplete_rejected(self, shop: dict) -> None:
        count = counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        _record_all(shop, count, [{"variant": shop["variant_a"], "counted_qty": Decimal("10")}])
        with pytest.raises(ServiceError) as exc:
            counts.finalize_count(shop["tenant"], count=count, created_by=shop["user"])
        assert exc.value.code == "COUNT_INCOMPLETE"

    def test_system_qty_never_rewritten(self, shop: dict) -> None:
        count = _finalize_ready(shop)
        counts.finalize_count(shop["tenant"], count=count, created_by=shop["user"])
        item_a = count.items.get(variant=shop["variant_a"])
        assert item_a.system_qty == Decimal("10")  # snapshot survives finalize


class TestCancel:
    def test_cancel_open(self, shop: dict) -> None:
        count = counts.start_count(shop["tenant"], branch=shop["branch"], created_by=shop["user"])
        cancelled = counts.cancel_count(shop["tenant"], count=count)
        assert cancelled.status == StockCount.Status.CANCELLED

    def test_cancel_finalized_is_409(self, shop: dict) -> None:
        count = _finalize_ready(shop)
        counts.finalize_count(shop["tenant"], count=count, created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            counts.cancel_count(shop["tenant"], count=count)
        assert exc.value.code == "COUNT_STATE_INVALID"

    def test_record_on_finalized_is_409(self, shop: dict) -> None:
        count = _finalize_ready(shop)
        counts.finalize_count(shop["tenant"], count=count, created_by=shop["user"])
        with pytest.raises(ServiceError) as exc:
            _record_all(shop, count, [{"variant": shop["variant_a"], "counted_qty": Decimal("9")}])
        assert exc.value.code == "COUNT_STATE_INVALID"
