"""API tests for inventory endpoints — happy path, auth-denied, validation,
and the cost-price leak rules (ARCHITECTURE §6 invariant 10).

Patterns mirror apps/catalog/tests/test_catalog_api.py: full stack
(TenantMiddleware → JWT → HasPermission), permissions granted BEFORE login
so the permission cache never sees a stale empty set.
"""

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    ItemVariantFactory,
    RoleFactory,
    RolePermissionFactory,
    StockLevelFactory,
    StockMovementFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
LEVELS_URL = "/api/v1/inventory/levels"
MOVEMENTS_URL = "/api/v1/inventory/movements"
OPENING_URL = "/api/v1/inventory/opening"
ADJUST_URL = "/api/v1/inventory/adjustments"
WRITE_OFF_URL = "/api/v1/inventory/write-offs"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug=SLUG)


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


@pytest.fixture
def refs(tenant: Any) -> dict[str, Any]:
    return {
        "branch": BranchFactory(tenant=tenant),
        "variant": ItemVariantFactory(tenant=tenant),
    }


def grant(tenant: Any, user: Any, *codes: str) -> None:
    role = RoleFactory(tenant=tenant)
    for code in codes:
        RolePermissionFactory(
            tenant=tenant, role=role, permission=Permission.objects.get(code=code)
        )
    UserRoleFactory(tenant=tenant, user=user, role=role)


def auth_client(user: Any, slug: str = SLUG) -> APIClient:
    tokens = (
        APIClient()
        .post(
            "/api/v1/auth/token",
            {"phone": user.phone, "password": DEFAULT_PASSWORD},
            **host(slug),
        )
        .json()["data"]
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return client


class TestAuthAndPermissions:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(LEVELS_URL, **host()).status_code == 401

    def test_missing_stock_view_is_403(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "sale.create")
        assert auth_client(user).get(LEVELS_URL, **host()).status_code == 403

    def test_write_without_stock_adjust_is_403(self, tenant: Any, user: Any, refs: Any) -> None:
        grant(tenant, user, "stock.view")
        payload = {
            "branch": str(refs["branch"].pk),
            "variant": str(refs["variant"].pk),
            "qty": "5",
            "unit_cost": "100.00",
        }
        assert auth_client(user).post(OPENING_URL, payload, **host()).status_code == 403


class TestWritePaths:
    def test_opening_happy_path(self, tenant: Any, user: Any, refs: Any) -> None:
        grant(tenant, user, "stock.adjust", "pricing.view_cost")
        payload = {
            "branch": str(refs["branch"].pk),
            "variant": str(refs["variant"].pk),
            "qty": "10",
            "unit_cost": "150.00",
            "note": "Opening stock",
        }
        response = auth_client(user).post(OPENING_URL, payload, **host())
        assert response.status_code == 201
        data = response.json()["data"]
        assert data["type"] == "OPENING"
        assert data["qty_delta"] == "10.000"
        assert data["balance_after"] == "10.000"
        assert data["unit_cost"] == "150.00"  # cost user sees it
        assert data["business_date_bs"]  # denormalized at write time

    def test_adjustment_and_write_off_flow(self, tenant: Any, user: Any, refs: Any) -> None:
        grant(tenant, user, "stock.adjust")
        client = auth_client(user)
        base = {"branch": str(refs["branch"].pk), "variant": str(refs["variant"].pk)}
        client.post(OPENING_URL, {**base, "qty": "10", "unit_cost": "100"}, **host())

        adjust = client.post(
            ADJUST_URL, {**base, "qty_delta": "-4", "reason": "Count fix"}, **host()
        )
        assert adjust.status_code == 201
        assert adjust.json()["data"]["balance_after"] == "6.000"

        write_off = client.post(
            WRITE_OFF_URL, {**base, "qty": "2", "reason": "Rat damage"}, **host()
        )
        assert write_off.status_code == 201
        assert write_off.json()["data"]["type"] == "DAMAGE"

    def test_insufficient_stock_error(self, tenant: Any, user: Any, refs: Any) -> None:
        grant(tenant, user, "stock.adjust")
        client = auth_client(user)
        base = {"branch": str(refs["branch"].pk), "variant": str(refs["variant"].pk)}
        client.post(OPENING_URL, {**base, "qty": "2", "unit_cost": "100"}, **host())
        response = client.post(
            ADJUST_URL, {**base, "qty_delta": "-5", "reason": "Too much"}, **host()
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "STOCK_INSUFFICIENT"
        # Invariant 10: the error path must not disclose any cost figure.
        assert "cost" not in body["error"]["message"].lower()

    def test_reason_required_validation(self, tenant: Any, user: Any, refs: Any) -> None:
        grant(tenant, user, "stock.adjust")
        client = auth_client(user)
        base = {"branch": str(refs["branch"].pk), "variant": str(refs["variant"].pk)}
        client.post(OPENING_URL, {**base, "qty": "2", "unit_cost": "100"}, **host())
        response = client.post(ADJUST_URL, {**base, "qty_delta": "1", "reason": " "}, **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "REASON_REQUIRED"

    def test_cross_tenant_branch_ref_is_404(self, tenant: Any, user: Any, refs: Any) -> None:
        grant(tenant, user, "stock.adjust")
        other = TenantFactory(slug="othershop")
        foreign_branch = BranchFactory(tenant=other)
        payload = {
            "branch": str(foreign_branch.pk),
            "variant": str(refs["variant"].pk),
            "qty": "5",
            "unit_cost": "100",
        }
        response = auth_client(user).post(OPENING_URL, payload, **host())
        assert response.status_code == 404


class TestCostVisibility:
    """Invariant 10: cost columns only with pricing.view_cost."""

    def test_levels_hide_avg_cost_without_permission(
        self, tenant: Any, user: Any, refs: Any
    ) -> None:
        StockLevelFactory(
            tenant=tenant, branch=refs["branch"], variant=refs["variant"], avg_cost="120.00"
        )
        grant(tenant, user, "stock.view")
        response = auth_client(user).get(LEVELS_URL, **host())
        assert response.status_code == 200
        row = response.json()["data"][0]
        assert "avg_cost" not in row

    def test_levels_show_avg_cost_with_permission(self, tenant: Any, user: Any, refs: Any) -> None:
        StockLevelFactory(
            tenant=tenant, branch=refs["branch"], variant=refs["variant"], avg_cost="120.00"
        )
        grant(tenant, user, "stock.view", "pricing.view_cost")
        response = auth_client(user).get(LEVELS_URL, **host())
        assert response.json()["data"][0]["avg_cost"] == "120.00"

    def test_movements_hide_unit_cost_without_permission(
        self, tenant: Any, user: Any, refs: Any
    ) -> None:
        StockMovementFactory(
            tenant=tenant, branch=refs["branch"], variant=refs["variant"], unit_cost="99.00"
        )
        grant(tenant, user, "stock.view")
        response = auth_client(user).get(MOVEMENTS_URL, **host())
        assert "unit_cost" not in response.json()["data"][0]

    def test_movements_show_unit_cost_with_permission(
        self, tenant: Any, user: Any, refs: Any
    ) -> None:
        StockMovementFactory(
            tenant=tenant, branch=refs["branch"], variant=refs["variant"], unit_cost="99.00"
        )
        grant(tenant, user, "stock.view", "pricing.view_cost")
        response = auth_client(user).get(MOVEMENTS_URL, **host())
        assert response.json()["data"][0]["unit_cost"] == "99.00"


class TestListEndpoints:
    def test_levels_annotate_reorder_threshold(self, tenant: Any, user: Any, refs: Any) -> None:
        """The levels list annotates reorder_level + is_low so the UI can
        flag low rows without a per-row query (same source of truth as the
        low-stock report: item.reorder_level)."""
        from tests.factories import ItemFactory

        low_item = ItemFactory(tenant=tenant, reorder_level="10")
        low_variant = ItemVariantFactory(tenant=tenant, item=low_item)
        StockLevelFactory(
            tenant=tenant, branch=refs["branch"], variant=low_variant, qty_on_hand="4"
        )
        ok_variant = ItemVariantFactory(tenant=tenant)  # no reorder level
        StockLevelFactory(tenant=tenant, branch=refs["branch"], variant=ok_variant, qty_on_hand="4")
        grant(tenant, user, "stock.view")
        response = auth_client(user).get(LEVELS_URL, **host())
        rows = {row["variant_sku"]: row for row in response.json()["data"]}
        assert rows[low_variant.sku]["reorder_level"] == "10.000"
        assert rows[low_variant.sku]["is_low"] is True
        assert rows[ok_variant.sku]["reorder_level"] is None
        assert rows[ok_variant.sku]["is_low"] is False
        # Row photos ride along for the visual stock list (null when unset).
        assert rows[low_variant.sku]["image_url"] is None
        # Cost rule unchanged: no avg_cost without pricing.view_cost.
        assert "avg_cost" not in rows[low_variant.sku]

    def test_levels_search_by_sku(self, tenant: Any, user: Any, refs: Any) -> None:
        StockLevelFactory(tenant=tenant, branch=refs["branch"], variant=refs["variant"])
        other_variant = ItemVariantFactory(tenant=tenant, sku="ZZZ-999")
        StockLevelFactory(tenant=tenant, branch=refs["branch"], variant=other_variant)
        grant(tenant, user, "stock.view")
        response = auth_client(user).get(LEVELS_URL, {"search": refs["variant"].sku}, **host())
        data = response.json()["data"]
        assert len(data) == 1
        assert data[0]["variant_sku"] == refs["variant"].sku

    def test_movements_filter_by_type_and_date(self, tenant: Any, user: Any, refs: Any) -> None:
        from datetime import date

        StockMovementFactory(
            tenant=tenant,
            branch=refs["branch"],
            variant=refs["variant"],
            type="OPENING",
            business_date_ad=date(2026, 1, 5),
        )
        StockMovementFactory(
            tenant=tenant,
            branch=refs["branch"],
            variant=refs["variant"],
            type="DAMAGE",
            business_date_ad=date(2026, 2, 5),
        )
        grant(tenant, user, "stock.view")
        client = auth_client(user)

        by_type = client.get(MOVEMENTS_URL, {"type": "DAMAGE"}, **host()).json()["data"]
        assert len(by_type) == 1
        assert by_type[0]["type"] == "DAMAGE"

        by_date = client.get(
            MOVEMENTS_URL, {"date_from": "2026-01-01", "date_to": "2026-01-31"}, **host()
        ).json()["data"]
        assert len(by_date) == 1
        assert by_date[0]["type"] == "OPENING"

    def test_movements_reject_bad_date(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "stock.view")
        response = auth_client(user).get(MOVEMENTS_URL, {"date_from": "not-a-date"}, **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "DATE_INVALID"

    def test_levels_pagination_meta(self, tenant: Any, user: Any, refs: Any) -> None:
        for _ in range(3):
            StockLevelFactory(tenant=tenant, branch=refs["branch"])
        grant(tenant, user, "stock.view")
        response = auth_client(user).get(LEVELS_URL, {"limit": 2}, **host())
        body = response.json()
        assert len(body["data"]) == 2
        assert body["meta"]["count"] == 3
        assert body["meta"]["total_pages"] == 2
