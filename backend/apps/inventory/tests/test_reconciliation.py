"""Monthly stock-ledger projection reconciliation tests."""

import logging
from decimal import Decimal
from typing import Any

import pytest
from django.conf import settings

from apps.inventory import transfers
from apps.inventory.models import StockLevel
from apps.inventory.reconciliation import reconcile_stock_projection
from apps.inventory.services import post_opening_stock
from apps.inventory.tasks import reconcile_stock_levels
from apps.tenants.constants import TenantStatus
from tests.factories import BranchFactory, ItemVariantFactory, TenantFactory, UserFactory

pytestmark = pytest.mark.django_db


def _stock(tenant: Any, *, qty: str = "10", cost: str = "500.00") -> dict[str, Any]:
    user = UserFactory(tenant=tenant)
    branch = BranchFactory(tenant=tenant)
    variant = ItemVariantFactory(tenant=tenant)
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        qty=Decimal(qty),
        unit_cost=Decimal(cost),
        created_by=user,
    )
    return {"tenant": tenant, "user": user, "branch": branch, "variant": variant}


def test_reconciliation_repairs_quantity_and_average_cost() -> None:
    shop = _stock(TenantFactory(), qty="10", cost="500.00")
    StockLevel.objects.filter(
        tenant=shop["tenant"], branch=shop["branch"], variant=shop["variant"]
    ).update(qty_on_hand=Decimal("99"), avg_cost=Decimal("1.00"))

    result = reconcile_stock_projection(shop["tenant"])

    level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant"])
    assert level.qty_on_hand == Decimal("10")
    assert level.avg_cost == Decimal("500.00")
    assert result.levels_checked == 1
    assert len(result.drifts) == 1
    assert result.drifts[0].actual_qty == Decimal("99")
    assert result.drifts[0].expected_qty == Decimal("10")
    assert result.drifts[0].actual_avg_cost == Decimal("1.00")
    assert result.drifts[0].expected_avg_cost == Decimal("500.00")


def test_reconciliation_recreates_a_missing_projection_row() -> None:
    shop = _stock(TenantFactory(), qty="7", cost="250.00")
    StockLevel.objects.filter(branch=shop["branch"], variant=shop["variant"]).delete()

    result = reconcile_stock_projection(shop["tenant"])

    level = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant"])
    assert level.qty_on_hand == Decimal("7")
    assert level.avg_cost == Decimal("250.00")
    assert len(result.drifts) == 1
    assert result.drifts[0].projection_missing is True


def test_reconciliation_zeros_a_projection_without_ledger_rows() -> None:
    tenant = TenantFactory()
    branch = BranchFactory(tenant=tenant)
    variant = ItemVariantFactory(tenant=tenant)
    StockLevel.objects.create(
        tenant=tenant,
        branch=branch,
        variant=variant,
        qty_on_hand=Decimal("4"),
        avg_cost=Decimal("99.00"),
    )

    result = reconcile_stock_projection(tenant)

    level = StockLevel.objects.get(branch=branch, variant=variant)
    assert level.qty_on_hand == Decimal("0")
    assert level.avg_cost == Decimal("0.00")
    assert len(result.drifts) == 1


def test_reconciliation_reports_in_transit_without_restoring_source_stock() -> None:
    shop = _stock(TenantFactory(), qty="10", cost="500.00")
    destination = BranchFactory(tenant=shop["tenant"])
    transfer = transfers.create_transfer(
        shop["tenant"],
        from_branch=shop["branch"],
        to_branch=destination,
        lines=[{"variant": shop["variant"], "qty": Decimal("4")}],
        note="Rebalance",
        created_by=shop["user"],
    )
    transfers.send_transfer(shop["tenant"], transfer=transfer, created_by=shop["user"])

    result = reconcile_stock_projection(shop["tenant"])

    source = StockLevel.objects.get(branch=shop["branch"], variant=shop["variant"])
    assert source.qty_on_hand == Decimal("6")
    assert result.in_transit_qty == Decimal("4")
    assert result.drifts == ()


def test_monthly_task_repairs_active_tenants_and_emits_drift_alert(
    caplog: pytest.LogCaptureFixture,
) -> None:
    first = _stock(TenantFactory(slug="reconcile-one"))
    second = _stock(TenantFactory(slug="reconcile-two"), qty="3")
    inactive = _stock(TenantFactory(slug="reconcile-inactive", status=TenantStatus.SUSPENDED))
    for shop in (first, second, inactive):
        StockLevel.objects.filter(
            branch=shop["branch"], variant=shop["variant"]
        ).update(qty_on_hand=Decimal("999"))

    with caplog.at_level(logging.ERROR, logger="apps.inventory.tasks"):
        result = reconcile_stock_levels()

    assert result == {
        "tenants_processed": 2,
        "levels_checked": 2,
        "drifts_repaired": 2,
        "in_transit_qty": "0.000",
    }
    assert StockLevel.objects.get(
        branch=first["branch"], variant=first["variant"]
    ).qty_on_hand == Decimal("10")
    assert StockLevel.objects.get(
        branch=second["branch"], variant=second["variant"]
    ).qty_on_hand == Decimal("3")
    assert StockLevel.objects.get(
        branch=inactive["branch"], variant=inactive["variant"]
    ).qty_on_hand == Decimal("999")
    assert any(
        record.message == "Stock projection drift repaired"
        and record.tenant_id in {str(first["tenant"].pk), str(second["tenant"].pk)}
        and record.drift_count == 1
        for record in caplog.records
    )


def test_monthly_reconciliation_is_scheduled() -> None:
    entry = settings.CELERY_BEAT_SCHEDULE["inventory-reconcile-stock-monthly"]
    assert entry["task"] == "apps.inventory.tasks.reconcile_stock_levels"
    assert entry["schedule"].day_of_month == {1}
