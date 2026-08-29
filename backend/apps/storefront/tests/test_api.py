"""Public storefront API tests — host resolution, plan gate, cost-safe payloads."""

from decimal import Decimal
from typing import Any, cast

import pytest
from rest_framework.test import APIClient

from apps.storefront.selectors import extract_shopfront_label
from apps.tenants.models import Tenant, TenantFeatureOverride
from tests.factories import (
    BranchFactory,
    CategoryFactory,
    ItemFactory,
    ItemVariantFactory,
    StockLevelFactory,
    TenantFactory,
)

pytestmark = pytest.mark.django_db

SITE_URL = "/api/v1/storefront/site"
PRODUCTS_URL = "/api/v1/storefront/products"
ROOT = "dokan.com.np"


def shopfront_host(label: str) -> dict[str, str]:
    return {"HTTP_HOST": f"{label}.shop.{ROOT}"}


def make_shop(slug: str = "yak-pos", shopfront: str = "yak", **kwargs: Any) -> Tenant:
    tenant = cast("Tenant", TenantFactory(slug=slug, shopfront_subdomain=shopfront, **kwargs))
    TenantFeatureOverride.objects.create(tenant=tenant, key="features.ecommerce", value=True)
    return tenant


class TestShopfrontHostParsing:
    @pytest.mark.parametrize(
        ("host", "expected"),
        [
            ("yak.shop.dokan.com.np", "yak"),
            ("YAK.shop.dokan.com.np", "yak"),
            ("yak.shop.dokan.com.np:8443", "yak"),
            ("yak.shop.localhost", "yak"),
            ("yak-gantok.dokan.com.np", None),  # POS host, not a shopfront
            ("deep.yak.shop.dokan.com.np", None),  # nested labels rejected
            ("shop.dokan.com.np", None),  # no label
            ("dokan.com.np", None),
        ],
    )
    def test_extract_shopfront_label(self, host: str, expected: str | None) -> None:
        root = "localhost" if host.endswith("localhost") else ROOT
        assert extract_shopfront_label(host, root) == expected


class TestStorefrontSite:
    def test_site_payload(self) -> None:
        shop = make_shop(name="YAK HANDLOOMS", currency="INR", shopfront_template="bazaar")
        BranchFactory(tenant=shop, is_default=True, phone="9800000000", address="MG Marg")
        jackets = CategoryFactory(tenant=shop, name="Jacket")
        ItemFactory(tenant=shop, category=jackets)
        CategoryFactory(tenant=shop, name="Empty")  # hidden: zero products

        response = APIClient().get(SITE_URL, **shopfront_host("yak"))

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["shop_name"] == "YAK HANDLOOMS"
        assert data["currency"] == "INR"
        assert data["template"] == "bazaar"
        assert data["contact"] == {"phone": "9800000000", "address": "MG Marg"}
        assert data["categories"] == [
            {
                "id": str(jackets.pk),
                "name": "Jacket",
                "name_np": jackets.name_np,
                "product_count": 1,
            }
        ]

    def test_unknown_shopfront_is_404(self) -> None:
        assert APIClient().get(SITE_URL, **shopfront_host("nope")).status_code == 404

    def test_suspended_shop_is_404(self) -> None:
        make_shop(status="SUSPENDED")
        assert APIClient().get(SITE_URL, **shopfront_host("yak")).status_code == 404

    def test_ecommerce_feature_required(self) -> None:
        TenantFactory(slug="plain-pos", shopfront_subdomain="plain", status="ACTIVE")
        response = APIClient().get(SITE_URL, **shopfront_host("plain"))
        assert response.status_code == 402
        assert response.json()["error"]["code"] == "PLAN_FEATURE_REQUIRED"

    def test_pos_host_is_not_a_shopfront(self) -> None:
        make_shop()
        response = APIClient().get(SITE_URL, HTTP_HOST=f"yak-pos.{ROOT}")
        assert response.status_code == 404


class TestStorefrontProducts:
    def test_product_grid_payload_is_cost_safe(self) -> None:
        shop = make_shop()
        category = CategoryFactory(tenant=shop, name="Jacket")
        item = ItemFactory(
            tenant=shop,
            name="Thin Sunblock",
            category=category,
            min_selling_price=Decimal("800.00"),
            max_selling_price=Decimal("1600.00"),
        )
        variant = ItemVariantFactory(tenant=shop, item=item)
        StockLevelFactory(tenant=shop, variant=variant, qty_on_hand=Decimal("4"))
        ItemFactory(tenant=shop, name="Out Of Stock Tee")
        ItemFactory(tenant=shop, name="Hidden", is_active=False)

        response = APIClient().get(PRODUCTS_URL, **shopfront_host("yak"))

        assert response.status_code == 200
        payload = response.json()
        assert payload["meta"]["count"] == 2
        rows = {row["name"]: row for row in payload["data"]}
        stocked = rows["Thin Sunblock"]
        assert stocked["in_stock"] is True
        assert stocked["price_min"] == "800.00"
        assert stocked["price_max"] == "1600.00"
        assert stocked["category"] == "Jacket"
        assert rows["Out Of Stock Tee"]["in_stock"] is False
        for row in payload["data"]:
            # Never leak cost, quantities, or internal pricing machinery.
            assert set(row) == {
                "id",
                "code",
                "name",
                "name_np",
                "image",
                "category",
                "brand",
                "price_min",
                "price_max",
                "in_stock",
            }

    def test_category_and_search_filters(self) -> None:
        shop = make_shop()
        jackets = CategoryFactory(tenant=shop, name="Jacket")
        ItemFactory(tenant=shop, name="Rain Shell", category=jackets)
        ItemFactory(tenant=shop, name="Track Pant")

        by_category = APIClient().get(
            PRODUCTS_URL, {"category": str(jackets.pk)}, **shopfront_host("yak")
        )
        assert [row["name"] for row in by_category.json()["data"]] == ["Rain Shell"]

        by_search = APIClient().get(PRODUCTS_URL, {"q": "track"}, **shopfront_host("yak"))
        assert [row["name"] for row in by_search.json()["data"]] == ["Track Pant"]

    def test_catalog_is_isolated_per_shopfront(self) -> None:
        shop = make_shop()
        other = make_shop(slug="rival-pos", shopfront="rival")
        ItemFactory(tenant=shop, name="Mine")
        ItemFactory(tenant=other, name="Theirs")

        response = APIClient().get(PRODUCTS_URL, **shopfront_host("yak"))

        assert [row["name"] for row in response.json()["data"]] == ["Mine"]
