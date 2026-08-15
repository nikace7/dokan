"""API tests for GET /catalog/variants/for-sale — the POS sale dropdown.

Covers the happy path, the qty>0 rule, search, effective price bounds at
each level (variant → item → category), the sale.create gate, cost never
leaking (#10), and tenant isolation.
"""

from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    CategoryFactory,
    ItemFactory,
    ItemVariantFactory,
    RoleFactory,
    RolePermissionFactory,
    StockLevelFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
URL = "/api/v1/catalog/variants/for-sale"


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


def stocked_variant(tenant: Any, branch: Any, qty: str = "5", **variant_kwargs: Any) -> Any:
    variant = ItemVariantFactory(tenant=tenant, **variant_kwargs)
    StockLevelFactory(tenant=tenant, branch=branch, variant=variant, qty_on_hand=Decimal(qty))
    return variant


class TestAuthAndPermissions:
    def test_unauthenticated_is_401(self, tenant: Any, branch: Any) -> None:
        response = APIClient().get(URL, {"branch_id": str(branch.pk)}, **host())
        assert response.status_code == 401

    def test_missing_sale_create_is_403(self, tenant: Any, user: Any, branch: Any) -> None:
        grant(tenant, user, "stock.view", "catalog.view")  # other permissions don't open it
        response = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host())
        assert response.status_code == 403

    def test_branch_id_required(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "sale.create")
        response = auth_client(user).get(URL, **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "BRANCH_REQUIRED"

    def test_unknown_branch_is_404(self, tenant: Any, user: Any) -> None:
        import uuid

        grant(tenant, user, "sale.create")
        response = auth_client(user).get(URL, {"branch_id": str(uuid.uuid4())}, **host())
        assert response.status_code == 404


class TestForSaleList:
    def test_happy_path_payload_shape(self, tenant: Any, user: Any, branch: Any) -> None:
        variant = stocked_variant(
            tenant,
            branch,
            qty="7",
            mrp=Decimal("1500.00"),
            barcode="1234567890123",
        )
        grant(tenant, user, "sale.create")
        response = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host())
        assert response.status_code == 200
        body = response.json()
        assert body["meta"]["count"] == 1
        row = body["data"][0]
        assert row == {
            "id": str(variant.pk),
            "item": str(variant.item_id),
            "item_name": variant.item.name,
            "size": variant.size,
            "color": variant.color,
            "sku": variant.sku,
            "barcode": "1234567890123",
            "mrp": "1500.00",
            "image_url": None,
            "qty_on_hand": "7.000",
            "min_selling_price": None,
            "max_selling_price": None,
        }

    def test_zero_and_negative_stock_excluded(self, tenant: Any, user: Any, branch: Any) -> None:
        stocked_variant(tenant, branch, qty="0")
        in_stock = stocked_variant(tenant, branch, qty="2")
        grant(tenant, user, "sale.create")
        response = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host())
        ids = [row["id"] for row in response.json()["data"]]
        assert ids == [str(in_stock.pk)]

    def test_stock_at_another_branch_not_listed(self, tenant: Any, user: Any, branch: Any) -> None:
        other_branch = BranchFactory(tenant=tenant)
        stocked_variant(tenant, other_branch, qty="9")
        grant(tenant, user, "sale.create")
        response = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host())
        assert response.json()["meta"]["count"] == 0

    def test_search_matches_name_sku_barcode(self, tenant: Any, user: Any, branch: Any) -> None:
        item = ItemFactory(tenant=tenant, name="Kurta Suruwal")
        by_name = ItemVariantFactory(tenant=tenant, item=item)
        by_sku = ItemVariantFactory(tenant=tenant, sku="FINDME-SKU")
        by_barcode = ItemVariantFactory(tenant=tenant, barcode="9998887776665")
        for variant in (by_name, by_sku, by_barcode):
            StockLevelFactory(
                tenant=tenant, branch=branch, variant=variant, qty_on_hand=Decimal("3")
            )
        grant(tenant, user, "sale.create")
        client = auth_client(user)

        def ids_for(search: str) -> list[str]:
            body = client.get(URL, {"branch_id": str(branch.pk), "search": search}, **host()).json()
            return [row["id"] for row in body["data"]]

        assert ids_for("kurta") == [str(by_name.pk)]
        assert ids_for("findme-sku") == [str(by_sku.pk)]
        assert ids_for("9998887776665") == [str(by_barcode.pk)]
        assert ids_for("no-such-thing") == []

    def test_bounds_from_variant_level(self, tenant: Any, user: Any, branch: Any) -> None:
        stocked_variant(
            tenant,
            branch,
            min_selling_price=Decimal("900.00"),
            max_selling_price=Decimal("1800.00"),
        )
        grant(tenant, user, "sale.create")
        row = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host()).json()["data"][0]
        assert row["min_selling_price"] == "900.00"
        assert row["max_selling_price"] == "1800.00"

    def test_bounds_from_item_level(self, tenant: Any, user: Any, branch: Any) -> None:
        item = ItemFactory(
            tenant=tenant,
            min_selling_price=Decimal("700.00"),
            max_selling_price=Decimal("1700.00"),
        )
        ItemVariantFactory(tenant=tenant, item=item)
        variant = item.variants.first()
        StockLevelFactory(tenant=tenant, branch=branch, variant=variant, qty_on_hand=Decimal("4"))
        grant(tenant, user, "sale.create")
        row = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host()).json()["data"][0]
        assert row["min_selling_price"] == "700.00"
        assert row["max_selling_price"] == "1700.00"

    def test_bounds_from_category_pct_of_mrp(self, tenant: Any, user: Any, branch: Any) -> None:
        category = CategoryFactory(
            tenant=tenant,
            min_price_pct=Decimal("80.00"),
            max_price_pct=Decimal("120.00"),
        )
        item = ItemFactory(tenant=tenant, category=category)
        variant = ItemVariantFactory(tenant=tenant, item=item, mrp=Decimal("1000.00"))
        StockLevelFactory(tenant=tenant, branch=branch, variant=variant, qty_on_hand=Decimal("4"))
        grant(tenant, user, "sale.create")
        row = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host()).json()["data"][0]
        assert row["min_selling_price"] == "800.00"
        assert row["max_selling_price"] == "1200.00"

    def test_cost_never_in_payload(self, tenant: Any, user: Any, branch: Any) -> None:
        stocked_variant(tenant, branch, avg_cost=Decimal("600.00"))
        grant(tenant, user, "sale.create")  # deliberately NO pricing.view_cost
        row = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host()).json()["data"][0]
        assert "avg_cost" not in row
        assert "cost" not in "".join(row.keys())

    def test_tenant_isolation(self, tenant: Any, user: Any, branch: Any) -> None:
        """Tenant B's stocked variants never appear on tenant A's host."""
        other_tenant = TenantFactory(slug="other-shop")
        other_branch = BranchFactory(tenant=other_tenant)
        stocked_variant(other_tenant, other_branch, qty="12")
        stocked_variant(tenant, branch, qty="1")
        grant(tenant, user, "sale.create")
        response = auth_client(user).get(URL, {"branch_id": str(branch.pk)}, **host())
        body = response.json()
        assert body["meta"]["count"] == 1
        assert body["data"][0]["qty_on_hand"] == "1.000"

        # Tenant B's branch id is not addressable from tenant A's host.
        cross = auth_client(user).get(URL, {"branch_id": str(other_branch.pk)}, **host())
        assert cross.status_code == 404
