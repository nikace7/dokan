"""API tests for pricing endpoints — happy path, auth-denied, validation,
and the resolve endpoint's no-cost-ever contract (invariant 10).
"""

from datetime import date
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


class TestAuthAndPermissions:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(RATE_TYPES_URL, **host()).status_code == 401

    def test_missing_pricing_view_is_403(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        assert auth_client(user).get(RATE_TYPES_URL, **host()).status_code == 403

    def test_write_without_pricing_edit_is_403(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "pricing.view")
        response = auth_client(user).post(RATE_TYPES_URL, {"code": "X", "name": "X"}, **host())
        assert response.status_code == 403

    def test_bounds_without_set_bounds_is_403(self, tenant: Any, user: Any, variant: Any) -> None:
        grant(tenant, user, "pricing.edit")
        response = auth_client(user).patch(
            f"/api/v1/pricing/bounds/variant/{variant.pk}",
            {"min_selling_price": "800.00"},
            **host(),
            format="json",
        )
        assert response.status_code == 403


class TestRateTypeCrud:
    def test_create_list_patch_deactivate(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "pricing.view", "pricing.edit")
        client = auth_client(user)

        created = client.post(
            RATE_TYPES_URL, {"code": "RETAIL", "name": "Khudra", "is_default": True}, **host()
        )
        assert created.status_code == 201
        rate_type_id = created.json()["data"]["id"]

        listed = client.get(RATE_TYPES_URL, **host())
        assert listed.json()["data"][0]["code"] == "RETAIL"
        assert listed.json()["meta"]["count"] == 1

        patched = client.patch(
            f"{RATE_TYPES_URL}/{rate_type_id}", {"name": "Khudra Rate"}, **host(), format="json"
        )
        assert patched.json()["data"]["name"] == "Khudra Rate"

        # Make another default so RETAIL can be deactivated.
        client.post(RATE_TYPES_URL, {"code": "THOK", "name": "Thok", "is_default": True}, **host())
        deactivated = client.delete(f"{RATE_TYPES_URL}/{rate_type_id}", **host())
        assert deactivated.json()["data"]["is_active"] is False

        active_only = client.get(RATE_TYPES_URL, {"is_active": "true"}, **host())
        assert active_only.json()["data"][0]["code"] == "THOK"

    def test_unknown_rate_type_is_404(self, tenant: Any, user: Any) -> None:
        import uuid

        grant(tenant, user, "pricing.edit")
        response = auth_client(user).patch(
            f"{RATE_TYPES_URL}/{uuid.uuid4()}", {"name": "x"}, **host(), format="json"
        )
        assert response.status_code == 404


class TestResolve:
    def test_resolve_with_default_rate_type(
        self, tenant: Any, user: Any, variant: Any, rate_type: Any
    ) -> None:
        ItemPriceFactory(
            tenant=tenant,
            rate_type=rate_type,
            variant=variant,
            price=Decimal("1200.00"),
            effective_from=date(2020, 1, 1),
        )
        grant(tenant, user, "pricing.view")
        response = auth_client(user).get(RESOLVE_URL, {"variant": str(variant.pk)}, **host())
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["price"] == "1200.00"
        assert data["source"] == "VARIANT"
        assert data["item_price"]["price"] == "1200.00"
        # Resolve never returns cost — with or without cost permission.
        assert "avg_cost" not in data
        assert "cost" not in data

    def test_resolve_mrp_fallback_has_null_item_price(
        self, tenant: Any, user: Any, variant: Any, rate_type: Any
    ) -> None:
        grant(tenant, user, "pricing.view")
        response = auth_client(user).get(RESOLVE_URL, {"variant": str(variant.pk)}, **host())
        data = response.json()["data"]
        assert data["source"] == "MRP"
        assert data["item_price"] is None

    def test_resolve_never_leaks_cost_even_with_cost_permission(
        self, tenant: Any, user: Any, variant: Any, rate_type: Any
    ) -> None:
        grant(tenant, user, "pricing.view", "pricing.view_cost")
        response = auth_client(user).get(RESOLVE_URL, {"variant": str(variant.pk)}, **host())
        assert "avg_cost" not in response.json()["data"]

    def test_resolve_missing_variant_param_is_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "pricing.view")
        response = auth_client(user).get(RESOLVE_URL, **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "VARIANT_REQUIRED"

    def test_resolve_unknown_variant_is_404(self, tenant: Any, user: Any) -> None:
        import uuid

        grant(tenant, user, "pricing.view")
        response = auth_client(user).get(RESOLVE_URL, {"variant": str(uuid.uuid4())}, **host())
        assert response.status_code == 404

    def test_resolve_restricted_rate_type_is_403(
        self, tenant: Any, user: Any, variant: Any
    ) -> None:
        restricted = RateTypeFactory(
            tenant=tenant,
            code="THOK",
            required_permission=Permission.objects.get(code="pricing.edit"),
        )
        grant(tenant, user, "pricing.view")
        response = auth_client(user).get(
            RESOLVE_URL, {"variant": str(variant.pk), "rate_type": str(restricted.pk)}, **host()
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "PRICING_RATE_FORBIDDEN"

    def test_resolve_without_default_rate_type_is_404(
        self, tenant: Any, user: Any, variant: Any
    ) -> None:
        grant(tenant, user, "pricing.view")
        response = auth_client(user).get(RESOLVE_URL, {"variant": str(variant.pk)}, **host())
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "RATE_TYPE_NOT_FOUND"


class TestPricesAndChanges:
    def test_set_price_and_list_and_change_log(
        self, tenant: Any, user: Any, variant: Any, rate_type: Any
    ) -> None:
        grant(tenant, user, "pricing.view", "pricing.edit")
        client = auth_client(user)
        payload = {
            "rate_type": str(rate_type.pk),
            "scope": "VARIANT",
            "variant": str(variant.pk),
            "price": "1200.00",
            "effective_from": "2026-01-01",
            "reason": "New season",
        }
        created = client.post(PRICES_URL, payload, **host(), format="json")
        assert created.status_code == 201
        assert created.json()["data"]["price"] == "1200.00"

        listed = client.get(
            PRICES_URL, {"rate_type": str(rate_type.pk), "scope": "VARIANT"}, **host()
        )
        assert listed.json()["meta"]["count"] == 1
        expected_label = f"{variant.item.name} · {variant.sku}"
        assert listed.json()["data"][0]["target_label"] == expected_label

        changes = client.get(CHANGES_URL, **host())
        entry = changes.json()["data"][0]
        assert entry["new_price"] == "1200.00"
        assert entry["old_price"] is None
        assert entry["reason"] == "New season"
        assert entry["changed_by_name"] == user.full_name
        assert entry["target_label"] == expected_label

    def test_set_price_validation_errors(
        self, tenant: Any, user: Any, variant: Any, rate_type: Any
    ) -> None:
        grant(tenant, user, "pricing.edit")
        client = auth_client(user)

        # Missing scope target
        response = client.post(
            PRICES_URL,
            {
                "rate_type": str(rate_type.pk),
                "scope": "VARIANT",
                "price": "100.00",
                "effective_from": "2026-01-01",
            },
            **host(),
            format="json",
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "SCOPE_TARGET_REQUIRED"

        # Shape error (bad date) → DRF validation envelope
        response = client.post(
            PRICES_URL,
            {
                "rate_type": str(rate_type.pk),
                "scope": "VARIANT",
                "variant": str(variant.pk),
                "price": "100.00",
                "effective_from": "not-a-date",
            },
            **host(),
            format="json",
        )
        assert response.status_code == 400

    def test_set_price_unknown_rate_type_is_404(self, tenant: Any, user: Any, variant: Any) -> None:
        import uuid

        grant(tenant, user, "pricing.edit")
        response = auth_client(user).post(
            PRICES_URL,
            {
                "rate_type": str(uuid.uuid4()),
                "scope": "VARIANT",
                "variant": str(variant.pk),
                "price": "100.00",
                "effective_from": "2026-01-01",
            },
            **host(),
            format="json",
        )
        assert response.status_code == 404

    def test_changes_filter_by_target(
        self, tenant: Any, user: Any, variant: Any, rate_type: Any
    ) -> None:
        grant(tenant, user, "pricing.view", "pricing.edit")
        client = auth_client(user)
        for price_value in ("1000.00", "1100.00"):
            client.post(
                PRICES_URL,
                {
                    "rate_type": str(rate_type.pk),
                    "scope": "VARIANT",
                    "variant": str(variant.pk),
                    "price": price_value,
                    "effective_from": "2026-01-01",
                },
                **host(),
                format="json",
            )
        filtered = client.get(
            CHANGES_URL, {"target_type": "VARIANT", "target": str(variant.pk)}, **host()
        )
        assert filtered.json()["meta"]["count"] == 2
        empty = client.get(CHANGES_URL, {"target_type": "CATEGORY"}, **host())
        assert empty.json()["meta"]["count"] == 0

    def test_item_and_category_target_labels(self, tenant: Any, user: Any, rate_type: Any) -> None:
        grant(tenant, user, "pricing.view", "pricing.edit")
        client = auth_client(user)
        item = ItemFactory(tenant=tenant)
        category = CategoryFactory(tenant=tenant)
        for scope, key, target in (
            ("ITEM", "item", item),
            ("CATEGORY", "category", category),
        ):
            created = client.post(
                PRICES_URL,
                {
                    "rate_type": str(rate_type.pk),
                    "scope": scope,
                    key: str(target.pk),
                    "price": "900.00",
                    "effective_from": "2026-01-01",
                },
                **host(),
                format="json",
            )
            assert created.status_code == 201
            assert created.json()["data"]["target_label"] == target.name

        prices = client.get(PRICES_URL, **host()).json()["data"]
        assert {row["target_label"] for row in prices} == {item.name, category.name}

        changes = client.get(CHANGES_URL, **host()).json()["data"]
        labels = {(row["target_type"], row["target_label"]) for row in changes}
        assert labels == {("ITEM", item.name), ("CATEGORY", category.name)}
