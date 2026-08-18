"""Service-layer tests for inventory — the money-critical math.

Covers: moving weighted average across repeated openings, the zero-floor
guard, balance_after correctness, BS/fiscal-year denormalization at write
time, and damage write-offs. apps/inventory/services is a 100%-coverage
module per docs/ARCHITECTURE.md — keep it that way.
"""

from datetime import date
from decimal import Decimal

import pytest

from apps.inventory import services
from apps.inventory.models import StockLevel, StockMovement
from core.responses import ServiceError
from tests.factories import (
    BranchFactory,
    ItemVariantFactory,
    StockLevelFactory,
    TenantFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def ctx() -> dict:
    tenant = TenantFactory()
    return {
        "tenant": tenant,
        "branch": BranchFactory(tenant=tenant),
        "variant": ItemVariantFactory(tenant=tenant),
        "user": UserFactory(tenant=tenant),
    }


def _level(ctx: dict) -> StockLevel:
    return StockLevel.objects.get(
        tenant=ctx["tenant"], branch=ctx["branch"], variant=ctx["variant"]
    )


class TestOpeningStock:
    def test_first_opening_sets_qty_and_avg(self, ctx: dict) -> None:
        movement = services.post_opening_stock(
            ctx["tenant"],
            branch=ctx["branch"],
            variant=ctx["variant"],
            qty=Decimal("10"),
            unit_cost=Decimal("100.00"),
            created_by=ctx["user"],
        )
        level = _level(ctx)
        assert level.qty_on_hand == Decimal("10")
        assert level.avg_cost == Decimal("100.00")
        assert movement.balance_after == Decimal("10")
        assert movement.type == StockMovement.MovementType.OPENING

    def test_weighted_average_across_repeated_openings(self, ctx: dict) -> None:
        tenant = ctx["tenant"]
        kw = {"branch": ctx["branch"], "variant": ctx["variant"], "created_by": ctx["user"]}
        services.post_opening_stock(tenant, qty=Decimal("10"), unit_cost=Decimal("100"), **kw)
        services.post_opening_stock(tenant, qty=Decimal("10"), unit_cost=Decimal("200"), **kw)
        services.post_opening_stock(tenant, qty=Decimal("20"), unit_cost=Decimal("300"), **kw)

        level = _level(ctx)
        # (20*150 + 20*300) / 40 = 225
        assert level.qty_on_hand == Decimal("40")
        assert level.avg_cost == Decimal("225.00")

        ctx["variant"].refresh_from_db()
        assert ctx["variant"].avg_cost == Decimal("225.00")  # inventory owns this column

        balances = list(
            StockMovement.objects.filter(tenant=tenant)
            .order_by("created_at")
            .values_list("balance_after", flat=True)
        )
        assert balances == [Decimal("10"), Decimal("20"), Decimal("40")]

    def test_opening_requires_positive_qty(self, ctx: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.post_opening_stock(
                ctx["tenant"],
                branch=ctx["branch"],
                variant=ctx["variant"],
                qty=Decimal("0"),
                unit_cost=Decimal("100"),
                created_by=ctx["user"],
            )
        assert exc.value.code == "QTY_INVALID"

    def test_opening_rejects_negative_cost(self, ctx: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.post_opening_stock(
                ctx["tenant"],
                branch=ctx["branch"],
                variant=ctx["variant"],
                qty=Decimal("5"),
                unit_cost=Decimal("-1"),
                created_by=ctx["user"],
            )
        assert exc.value.code == "COST_INVALID"

    def test_business_dates_denormalized_at_write_time(self, ctx: dict) -> None:
        """Golden-fixture pair: AD 2000-01-01 = BS 2056-09-17, FY 2056-57."""
        movement = services.post_opening_stock(
            ctx["tenant"],
            branch=ctx["branch"],
            variant=ctx["variant"],
            qty=Decimal("1"),
            unit_cost=Decimal("50"),
            created_by=ctx["user"],
            business_date=date(2000, 1, 1),
        )
        assert movement.business_date_ad == date(2000, 1, 1)
        assert movement.business_date_bs == "2056-09-17"
        assert movement.fiscal_year_bs == "2056-57"

    def test_note_stored(self, ctx: dict) -> None:
        movement = services.post_opening_stock(
            ctx["tenant"],
            branch=ctx["branch"],
            variant=ctx["variant"],
            qty=Decimal("2"),
            unit_cost=Decimal("10"),
            created_by=ctx["user"],
            note="Dashain stock",
        )
        assert movement.note == "Dashain stock"


class TestAdjustStock:
    def test_signed_adjustment_updates_balance(self, ctx: dict) -> None:
        tenant = ctx["tenant"]
        kw = {"branch": ctx["branch"], "variant": ctx["variant"], "created_by": ctx["user"]}
        services.post_opening_stock(tenant, qty=Decimal("10"), unit_cost=Decimal("100"), **kw)
        movement = services.adjust_stock(tenant, qty_delta=Decimal("-4"), reason="Count fix", **kw)

        assert movement.balance_after == Decimal("6")
        assert movement.type == StockMovement.MovementType.ADJUSTMENT
        assert movement.unit_cost is None
        assert _level(ctx).qty_on_hand == Decimal("6")

    def test_negative_beyond_floor_rejected(self, ctx: dict) -> None:
        tenant = ctx["tenant"]
        kw = {"branch": ctx["branch"], "variant": ctx["variant"], "created_by": ctx["user"]}
        services.post_opening_stock(tenant, qty=Decimal("5"), unit_cost=Decimal("100"), **kw)
        with pytest.raises(ServiceError) as exc:
            services.adjust_stock(tenant, qty_delta=Decimal("-6"), reason="Too much", **kw)
        assert exc.value.code == "STOCK_INSUFFICIENT"
        assert _level(ctx).qty_on_hand == Decimal("5")  # nothing written

    def test_avg_cost_unchanged_by_adjustments(self, ctx: dict) -> None:
        tenant = ctx["tenant"]
        kw = {"branch": ctx["branch"], "variant": ctx["variant"], "created_by": ctx["user"]}
        services.post_opening_stock(tenant, qty=Decimal("10"), unit_cost=Decimal("120"), **kw)
        services.adjust_stock(tenant, qty_delta=Decimal("-3"), reason="Damage found", **kw)
        services.adjust_stock(tenant, qty_delta=Decimal("2"), reason="Found in back", **kw)
        assert _level(ctx).avg_cost == Decimal("120.00")

    def test_zero_adjustment_rejected(self, ctx: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.adjust_stock(
                ctx["tenant"],
                branch=ctx["branch"],
                variant=ctx["variant"],
                qty_delta=Decimal("0"),
                reason="No-op",
                created_by=ctx["user"],
            )
        assert exc.value.code == "QTY_INVALID"

    def test_reason_required(self, ctx: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.adjust_stock(
                ctx["tenant"],
                branch=ctx["branch"],
                variant=ctx["variant"],
                qty_delta=Decimal("1"),
                reason="   ",
                created_by=ctx["user"],
            )
        assert exc.value.code == "REASON_REQUIRED"


class TestWriteOffDamage:
    def test_write_off_removes_stock(self, ctx: dict) -> None:
        tenant = ctx["tenant"]
        kw = {"branch": ctx["branch"], "variant": ctx["variant"], "created_by": ctx["user"]}
        services.post_opening_stock(tenant, qty=Decimal("10"), unit_cost=Decimal("80"), **kw)
        movement = services.write_off_damage(tenant, qty=Decimal("3"), reason="Rat damage", **kw)

        assert movement.type == StockMovement.MovementType.DAMAGE
        assert movement.qty_delta == Decimal("-3")
        assert movement.balance_after == Decimal("7")
        assert _level(ctx).qty_on_hand == Decimal("7")

    def test_write_off_beyond_floor_rejected(self, ctx: dict) -> None:
        tenant = ctx["tenant"]
        kw = {"branch": ctx["branch"], "variant": ctx["variant"], "created_by": ctx["user"]}
        services.post_opening_stock(tenant, qty=Decimal("2"), unit_cost=Decimal("80"), **kw)
        with pytest.raises(ServiceError) as exc:
            services.write_off_damage(tenant, qty=Decimal("3"), reason="Flood", **kw)
        assert exc.value.code == "STOCK_INSUFFICIENT"

    def test_write_off_requires_positive_qty(self, ctx: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.write_off_damage(
                ctx["tenant"],
                branch=ctx["branch"],
                variant=ctx["variant"],
                qty=Decimal("0"),
                reason="x",
                created_by=ctx["user"],
            )
        assert exc.value.code == "QTY_INVALID"

    def test_write_off_requires_reason(self, ctx: dict) -> None:
        with pytest.raises(ServiceError) as exc:
            services.write_off_damage(
                ctx["tenant"],
                branch=ctx["branch"],
                variant=ctx["variant"],
                qty=Decimal("1"),
                reason="",
                created_by=ctx["user"],
            )
        assert exc.value.code == "REASON_REQUIRED"


class TestLockLevelRace:
    def test_create_race_retries_with_locked_get(
        self, ctx: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Two transactions creating the same level: the loser's INSERT hits
        the unique constraint; it must retry with SELECT ... FOR UPDATE and
        get the winner's row."""
        from django.db import IntegrityError, transaction

        level: StockLevel = StockLevelFactory(
            tenant=ctx["tenant"], branch=ctx["branch"], variant=ctx["variant"]
        )

        class FakeQS:
            def filter(self, **kwargs: object) -> "FakeQS":
                return self

            def first(self) -> None:
                return None  # the loser's initial lookup misses

            def get(self, **kwargs: object) -> StockLevel:
                return level  # the winner's committed row

        def losing_create(**kwargs: object) -> StockLevel:
            raise IntegrityError("duplicate key value violates stock_level_branch_variant_uniq")

        monkeypatch.setattr(StockLevel.objects, "select_for_update", lambda: FakeQS())
        monkeypatch.setattr(StockLevel.objects, "create", losing_create)

        with transaction.atomic():
            got = services._lock_level(ctx["tenant"], ctx["branch"], ctx["variant"])
        assert got.pk == level.pk
