"""API tests for catalog endpoints — happy path, auth-denied, validation,
and the cost-price leak rules (AGENTS.md invariant 10).

Requests go through the full stack (TenantMiddleware → JWT → HasPermission)
with an explicit Host header; permissions are granted via roles BEFORE login
so the 5-minute permission cache never sees a stale empty set.
"""

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from tests.factories import (
    DEFAULT_PASSWORD,
    CategoryFactory,
    ItemFactory,
    ItemVariantFactory,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
VALID_EAN13 = "5901234123457"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug=SLUG)


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


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
        response = APIClient().get("/api/v1/catalog/items", **host())
        assert response.status_code == 401

    def test_missing_catalog_view_is_403(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "sale.create")  # some other permission
        response = auth_client(user).get("/api/v1/catalog/items", **host())
        assert response.status_code == 403

    def test_write_without_catalog_manage_is_403(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        response = auth_client(user).post("/api/v1/catalog/brands", {"name": "Nike"}, **host())
        assert response.status_code == 403

    def test_platform_host_is_refused(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        client = auth_client(user)
        response = client.get("/api/v1/catalog/items", HTTP_HOST="www.dokan.com.np")
        assert response.status_code == 403


class TestCrudFlow:
    def test_full_catalog_flow(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view", "catalog.manage")
        client = auth_client(user)

        chart = client.post(
            "/api/v1/catalog/size-charts", {"name": "Adult", "values": ["S", "M", "L"]}, **host()
        )
        assert chart.status_code == 201
        chart_id = chart.json()["data"]["id"]

        category = client.post(
            "/api/v1/catalog/categories", {"name": "Shirts", "size_chart": chart_id}, **host()
        )
        assert category.status_code == 201
        category_id = category.json()["data"]["id"]

        item = client.post(
            "/api/v1/catalog/items",
            {"code": "SH-001", "name": "Oxford Shirt", "category": category_id},
            **host(),
        )
        assert item.status_code == 201
        item_id = item.json()["data"]["id"]

        bulk = client.post(
            f"/api/v1/catalog/items/{item_id}/variants/bulk",
            {"sizes": ["S", "M"], "colors": ["White"], "mrp": "2500.00"},
            **host(),
        )
        assert bulk.status_code == 201
        payload = bulk.json()["data"]
        assert payload["created_count"] == 2
        assert payload["skipped_count"] == 0

        listing = client.get("/api/v1/catalog/items?search=oxford", **host())
        assert listing.status_code == 200
        body = listing.json()
        assert body["error"] is None
        assert body["meta"]["count"] == 1
        assert body["data"][0]["code"] == "SH-001"

    def test_duplicate_item_code_friendly_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.manage")
        ItemFactory(tenant=tenant, code="DUP")
        response = auth_client(user).post(
            "/api/v1/catalog/items", {"code": "DUP", "name": "Again"}, **host()
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "ALREADY_EXISTS"

    def test_invalid_barcode_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.manage")
        item = ItemFactory(tenant=tenant)
        response = auth_client(user).post(
            "/api/v1/catalog/variants",
            {
                "item": str(item.pk),
                "size": "L",
                "color": "Red",
                "sku": "V-1",
                "barcode": "5901234123458",
            },
            **host(),
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "BARCODE_INVALID"

    def test_delete_deactivates(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view", "catalog.manage")
        category = CategoryFactory(tenant=tenant)
        client = auth_client(user)
        response = client.delete(f"/api/v1/catalog/categories/{category.pk}", **host())
        assert response.status_code == 200
        category.refresh_from_db()
        assert category.is_active is False

        listing = client.get("/api/v1/catalog/categories?is_active=true", **host())
        assert listing.json()["meta"]["count"] == 0


class TestLookup:
    def test_lookup_by_barcode(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        ItemVariantFactory(tenant=tenant, barcode=VALID_EAN13, sku="LOOK-1")
        response = auth_client(user).get(
            f"/api/v1/catalog/variants/lookup?barcode={VALID_EAN13}", **host()
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["sku"] == "LOOK-1"
        assert data["item__name"]

    def test_lookup_by_sku(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        ItemVariantFactory(tenant=tenant, sku="LOOK-2")
        response = auth_client(user).get("/api/v1/catalog/variants/lookup?sku=LOOK-2", **host())
        assert response.status_code == 200

    def test_lookup_miss_is_404(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        response = auth_client(user).get("/api/v1/catalog/variants/lookup?sku=NOPE", **host())
        assert response.status_code == 404

    def test_lookup_without_param_is_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        response = auth_client(user).get("/api/v1/catalog/variants/lookup", **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "LOOKUP_PARAM_REQUIRED"


class TestCostVisibility:
    """Invariant 10: avg_cost must not leak without pricing.view_cost."""

    def test_lookup_hides_cost_without_permission(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        ItemVariantFactory(tenant=tenant, sku="COST-1", avg_cost="750.00")
        response = auth_client(user).get("/api/v1/catalog/variants/lookup?sku=COST-1", **host())
        assert response.status_code == 200
        assert "avg_cost" not in response.json()["data"]

    def test_lookup_shows_cost_with_permission(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view", "pricing.view_cost")
        ItemVariantFactory(tenant=tenant, sku="COST-2", avg_cost="750.00")
        response = auth_client(user).get("/api/v1/catalog/variants/lookup?sku=COST-2", **host())
        assert response.json()["data"]["avg_cost"] == "750.00"

    def test_variant_serializer_hides_cost_without_permission(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        variant = ItemVariantFactory(tenant=tenant, avg_cost="750.00")
        response = auth_client(user).get(
            f"/api/v1/catalog/variants?item={variant.item_id}", **host()
        )
        assert response.status_code == 200
        assert "avg_cost" not in response.json()["data"][0]

    def test_variant_serializer_shows_cost_with_permission(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view", "pricing.view_cost")
        variant = ItemVariantFactory(tenant=tenant, avg_cost="750.00")
        response = auth_client(user).get(
            f"/api/v1/catalog/variants?item={variant.item_id}", **host()
        )
        assert response.json()["data"][0]["avg_cost"] == "750.00"
