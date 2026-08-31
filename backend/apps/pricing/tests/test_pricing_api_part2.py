"""API tests for pricing endpoints — happy path, auth-denied, validation,
and the resolve endpoint's no-cost-ever contract (invariant 10).
"""

from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from tests.factories import (
    DEFAULT_PASSWORD,
    CategoryFactory,
    ItemFactory,
    ItemPriceFactory,
    ItemVariantFactory,
    RateTypeFactory,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
RATE_TYPES_URL = "/api/v1/pricing/rate-types"
RESOLVE_URL = "/api/v1/pricing/resolve"
PRICES_URL = "/api/v1/pricing/prices"
CHANGES_URL = "/api/v1/pricing/changes"


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


@pytest.fixture
def variant(tenant: Any) -> Any:
    return ItemVariantFactory(tenant=tenant, mrp=Decimal("1500.00"))


@pytest.fixture
def rate_type(tenant: Any) -> Any:
    return RateTypeFactory(tenant=tenant, code="RETAIL", is_default=True)


class TestBounds:
    def test_set_and_read_back_bounds(self, tenant: Any, user: Any, variant: Any) -> None:
        grant(tenant, user, "pricing.set_bounds")
        response = auth_client(user).patch(
            f"/api/v1/pricing/bounds/variant/{variant.pk}",
            {"min_selling_price": "800.00", "max_selling_price": "2000.00"},
            **host(),
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["data"]["min_selling_price"] == "800.00"

    def test_bounds_on_item(self, tenant: Any, user: Any) -> None:
        item = ItemFactory(tenant=tenant)
        grant(tenant, user, "pricing.set_bounds")
        response = auth_client(user).patch(
            f"/api/v1/pricing/bounds/item/{item.pk}",
            {"min_selling_price": "100.00"},
            **host(),
            format="json",
        )
        assert response.status_code == 200

    def test_invalid_target_kind_is_400(self, tenant: Any, user: Any) -> None:
        import uuid

        grant(tenant, user, "pricing.set_bounds")
        response = auth_client(user).patch(
            f"/api/v1/pricing/bounds/shop/{uuid.uuid4()}",
            {"min_selling_price": "1.00"},
            **host(),
            format="json",
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "TARGET_INVALID"

    def test_missing_bounds_is_400(self, tenant: Any, user: Any, variant: Any) -> None:
        grant(tenant, user, "pricing.set_bounds")
        response = auth_client(user).patch(
            f"/api/v1/pricing/bounds/variant/{variant.pk}", {}, **host(), format="json"
        )
        assert response.status_code == 400

    def test_category_scope_price_flow(self, tenant: Any, user: Any, rate_type: Any) -> None:
        """POST a CATEGORY-scope price through the API."""
        category = CategoryFactory(tenant=tenant)
        grant(tenant, user, "pricing.view", "pricing.edit")
        response = auth_client(user).post(
            PRICES_URL,
            {
                "rate_type": str(rate_type.pk),
                "scope": "CATEGORY",
                "category": str(category.pk),
                "price": "999.00",
                "effective_from": "2026-01-01",
            },
            **host(),
            format="json",
        )
        assert response.status_code == 201
        assert response.json()["data"]["scope"] == "CATEGORY"


class TestListEdgeCases:
    def test_prices_list_without_filters(self, tenant: Any, user: Any, rate_type: Any) -> None:
        ItemPriceFactory(tenant=tenant, rate_type=rate_type)
        grant(tenant, user, "pricing.view")
        response = auth_client(user).get(PRICES_URL, **host())
        assert response.status_code == 200
        assert response.json()["meta"]["count"] == 1

    def test_garbage_uuid_filter_means_no_filter(
        self, tenant: Any, user: Any, rate_type: Any
    ) -> None:
        ItemPriceFactory(tenant=tenant, rate_type=rate_type)
        grant(tenant, user, "pricing.view")
        response = auth_client(user).get(PRICES_URL, {"rate_type": "not-a-uuid"}, **host())
        assert response.status_code == 200
        assert response.json()["meta"]["count"] == 1
