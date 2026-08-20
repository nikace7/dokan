"""API tests for POST /catalog/products/quick-create — one-transaction
item + variant matrix + opening stock (the simplified Add product flow).

Patterns mirror apps/catalog/tests/test_catalog_api.py: full stack
(TenantMiddleware → JWT → HasPermission), permissions granted BEFORE login
so the permission cache never sees a stale empty set.
"""

from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.catalog.models import Item, ItemVariant
from apps.inventory.models import StockLevel
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
URL = "/api/v1/catalog/products/quick-create"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug=SLUG)


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


@pytest.fixture
def branch(tenant: Any) -> Any:
    return BranchFactory(tenant=tenant)


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


def payload(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "code": "0001",
        "name": "Uniqlo Jacket",
        "sizes": ["S", "M"],
        "colors": ["Black"],
        "mrp": "1800.00",
        "min_selling_price": "1000.00",
        "max_selling_price": "1500.00",
    }
    base.update(overrides)
    return base


class TestQuickCreateHappyPath:
    def test_item_variants_and_opening_stock_in_one_call(
        self, tenant: Any, user: Any, branch: Any
    ) -> None:
        grant(tenant, user, "catalog.manage", "stock.adjust")
        client = auth_client(user)
        response = client.post(
            URL,
            payload(
                stock={
                    "branch": str(branch.pk),
                    "unit_cost": "700.00",
                    "note": "",
                    "quantities": {"S::Black": "10", "M::Black": "12"},
                }
            ),
            format="json",
            **host(),
        )
        assert response.status_code == 201, response.json()
        data = response.json()["data"]
        assert data["variants_created"] == 2
        assert data["stock_movements"] == 2
        assert data["item"]["code"] == "0001"
        assert len(data["variants"]) == 2

        # No cost leakage: the user lacks pricing.view_cost (#10).
        for variant in data["variants"]:
            assert "avg_cost" not in variant

        variants = {v.sku: v for v in ItemVariant.objects.filter(tenant=tenant)}
        assert set(variants) == {"0001-S-BLACK", "0001-M-BLACK"}
        for sku, qty in (("0001-S-BLACK", "10"), ("0001-M-BLACK", "12")):
            level = StockLevel.objects.get(tenant=tenant, branch=branch, variant=variants[sku])
            assert level.qty_on_hand == Decimal(qty)
            variants[sku].refresh_from_db()
            assert variants[sku].avg_cost == Decimal("700.00")

    def test_without_stock_block_creates_item_and_variants_only(
        self, tenant: Any, user: Any
    ) -> None:
        grant(tenant, user, "catalog.manage")
        client = auth_client(user)
        response = client.post(URL, payload(), format="json", **host())
        assert response.status_code == 201, response.json()
        data = response.json()["data"]
        assert data["variants_created"] == 2
        assert data["stock_movements"] == 0
        assert StockLevel.objects.filter(tenant=tenant).count() == 0


class TestQuickCreatePermissions:
    def test_without_catalog_manage_is_403(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        response = auth_client(user).post(URL, payload(), format="json", **host())
        assert response.status_code == 403

    def test_stock_block_without_stock_adjust_is_403_and_atomic(
        self, tenant: Any, user: Any, branch: Any
    ) -> None:
        grant(tenant, user, "catalog.manage")  # no stock.adjust
        client = auth_client(user)
        response = client.post(
            URL,
            payload(
                stock={
                    "branch": str(branch.pk),
                    "unit_cost": "700.00",
                    "quantities": {"S::Black": "10"},
                }
            ),
            format="json",
            **host(),
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "PERMISSION_DENIED"
        assert Item.objects.filter(tenant=tenant).count() == 0
        assert ItemVariant.objects.filter(tenant=tenant).count() == 0


class TestQuickCreateValidation:
    def test_unknown_quantity_key_is_400(self, tenant: Any, user: Any, branch: Any) -> None:
        grant(tenant, user, "catalog.manage", "stock.adjust")
        client = auth_client(user)
        response = client.post(
            URL,
            payload(
                stock={
                    "branch": str(branch.pk),
                    "unit_cost": "700.00",
                    "quantities": {"L::Black": "10"},  # L was not submitted
                }
            ),
            format="json",
            **host(),
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "QUANTITY_KEY_INVALID"
        assert Item.objects.filter(tenant=tenant).count() == 0

    def test_zero_quantity_is_400_and_rolls_back_item(
        self, tenant: Any, user: Any, branch: Any
    ) -> None:
        grant(tenant, user, "catalog.manage", "stock.adjust")
        client = auth_client(user)
        response = client.post(
            URL,
            payload(
                stock={
                    "branch": str(branch.pk),
                    "unit_cost": "700.00",
                    "quantities": {"S::Black": "0", "M::Black": "12"},
                }
            ),
            format="json",
            **host(),
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "QTY_INVALID"
        # Atomicity: the item/variants from the same call are gone too.
        assert Item.objects.filter(tenant=tenant).count() == 0
        assert ItemVariant.objects.filter(tenant=tenant).count() == 0

    def test_branch_of_another_tenant_is_404(self, tenant: Any, user: Any) -> None:
        other_branch = BranchFactory()  # different tenant
        grant(tenant, user, "catalog.manage", "stock.adjust")
        client = auth_client(user)
        response = client.post(
            URL,
            payload(
                stock={
                    "branch": str(other_branch.pk),
                    "unit_cost": "700.00",
                    "quantities": {"S::Black": "10"},
                }
            ),
            format="json",
            **host(),
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "BRANCH_NOT_FOUND"
        assert Item.objects.filter(tenant=tenant).count() == 0

    def test_duplicate_item_code_is_a_friendly_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.manage")
        client = auth_client(user)
        first = client.post(URL, payload(), format="json", **host())
        assert first.status_code == 201

        second = client.post(URL, payload(), format="json", **host())
        assert second.status_code == 400
        assert second.json()["error"]["code"] == "ALREADY_EXISTS"
        assert "code" in second.json()["error"]["message"].lower()
        assert Item.objects.filter(tenant=tenant).count() == 1
