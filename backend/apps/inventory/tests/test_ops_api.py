"""API tests for transfers and counts endpoints."""

from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.inventory.services import post_opening_stock
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    ItemVariantFactory,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
TRANSFERS_URL = "/api/v1/inventory/transfers"
COUNTS_URL = "/api/v1/inventory/counts"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug=SLUG)


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


@pytest.fixture
def shop(tenant: Any, user: Any) -> dict[str, Any]:
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
    return {"branch_a": branch_a, "branch_b": branch_b, "variant": variant}


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


def transfer_payload(shop: dict, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "from_branch": str(shop["branch_a"].pk),
        "to_branch": str(shop["branch_b"].pk),
        "lines": [{"variant": str(shop["variant"].pk), "qty": "3"}],
    }
    payload.update(overrides)
    return payload


class TestAuthAndPermissions:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(TRANSFERS_URL, **host()).status_code == 401

    def test_read_requires_stock_view(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        assert auth_client(user).get(TRANSFERS_URL, **host()).status_code == 403

    def test_write_requires_stock_adjust(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "stock.view")
        response = auth_client(user).post(
            TRANSFERS_URL, transfer_payload(shop), **host(), format="json"
        )
        assert response.status_code == 403


class TestTransferApi:
    def test_full_flow(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "stock.view", "stock.adjust")
        client = auth_client(user)

        created = client.post(TRANSFERS_URL, transfer_payload(shop), **host(), format="json")
        assert created.status_code == 201
        transfer_id = created.json()["data"]["id"]
        assert created.json()["data"]["status"] == "DRAFT"

        sent = client.post(f"{TRANSFERS_URL}/{transfer_id}/send", {}, **host(), format="json")
        assert sent.status_code == 200
        assert sent.json()["data"]["status"] == "SENT"

        transit = client.get(f"{TRANSFERS_URL}/in-transit", **host())
        assert transit.json()["data"][0]["qty_in_transit"] == "3.000"

        received = client.post(
            f"{TRANSFERS_URL}/{transfer_id}/receive",
            {"lines": [{"variant": str(shop["variant"].pk), "qty": "2"}]},
            **host(),
            format="json",
        )
        assert received.status_code == 200
        assert received.json()["data"]["items"][0]["qty_received"] == "2.000"

        completed = client.post(
            f"{TRANSFERS_URL}/{transfer_id}/complete", {}, **host(), format="json"
        )
        assert completed.status_code == 200
        assert completed.json()["data"]["status"] == "RECEIVED"

        listed = client.get(TRANSFERS_URL, {"status": "RECEIVED"}, **host())
        assert listed.json()["meta"]["count"] == 1

    def test_unknown_variant_is_404(self, tenant: Any, user: Any, shop: dict) -> None:
        import uuid

        grant(tenant, user, "stock.adjust")
        response = auth_client(user).post(
            TRANSFERS_URL,
            transfer_payload(shop, lines=[{"variant": str(uuid.uuid4()), "qty": "1"}]),
            **host(),
            format="json",
        )
        assert response.status_code == 404

    def test_transfer_unit_cost_hidden_without_cost_perm(
        self, tenant: Any, user: Any, shop: dict
    ) -> None:
        grant(tenant, user, "stock.view", "stock.adjust")
        client = auth_client(user)
        created = client.post(TRANSFERS_URL, transfer_payload(shop), **host(), format="json")
        transfer_id = created.json()["data"]["id"]
        client.post(f"{TRANSFERS_URL}/{transfer_id}/send", {}, **host(), format="json")
        detail = client.get(f"{TRANSFERS_URL}/{transfer_id}", **host())
        assert "unit_cost" not in detail.json()["data"]["items"][0]

    def test_transfer_unit_cost_visible_with_cost_perm(
        self, tenant: Any, user: Any, shop: dict
    ) -> None:
        grant(tenant, user, "stock.view", "stock.adjust", "pricing.view_cost")
        client = auth_client(user)
        created = client.post(TRANSFERS_URL, transfer_payload(shop), **host(), format="json")
        transfer_id = created.json()["data"]["id"]
        client.post(f"{TRANSFERS_URL}/{transfer_id}/send", {}, **host(), format="json")
        detail = client.get(f"{TRANSFERS_URL}/{transfer_id}", **host())
        assert detail.json()["data"]["items"][0]["unit_cost"] == "500.00"


class TestCountApi:
    def test_full_flow(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "stock.view", "stock.adjust")
        client = auth_client(user)

        started = client.post(
            COUNTS_URL, {"branch": str(shop["branch_a"].pk)}, **host(), format="json"
        )
        assert started.status_code == 201
        count_id = started.json()["data"]["id"]
        items = started.json()["data"]["items"]
        assert len(items) == 1

        recorded = client.post(
            f"{COUNTS_URL}/{count_id}/record",
            {"counts": [{"variant": str(shop["variant"].pk), "counted_qty": "9"}]},
            **host(),
            format="json",
        )
        assert recorded.status_code == 200
        assert recorded.json()["data"]["items"][0]["variance"] == "-1.000"

        finalized = client.post(f"{COUNTS_URL}/{count_id}/finalize", {}, **host(), format="json")
        assert finalized.status_code == 200
        assert finalized.json()["data"]["status"] == "FINALIZED"

        listed = client.get(COUNTS_URL, {"status": "FINALIZED"}, **host())
        assert listed.json()["meta"]["count"] == 1

    def test_second_open_count_is_409(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "stock.adjust")
        client = auth_client(user)
        client.post(COUNTS_URL, {"branch": str(shop["branch_a"].pk)}, **host(), format="json")
        response = client.post(
            COUNTS_URL, {"branch": str(shop["branch_a"].pk)}, **host(), format="json"
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "COUNT_ALREADY_OPEN"
