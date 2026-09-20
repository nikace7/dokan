"""Public storefront visibility and featured-product behavior."""

import pytest
from rest_framework.test import APIClient

from apps.storefront.tests.test_api import PRODUCTS_URL, SITE_URL, make_shop, shopfront_host
from tests.factories import CategoryFactory, ItemFactory

pytestmark = pytest.mark.django_db


class TestMerchandising:
    def test_hidden_items_leave_the_grid_and_nav_counts(self) -> None:
        shop = make_shop()
        jackets = CategoryFactory(tenant=shop, name="Jacket")
        ItemFactory(tenant=shop, name="Online", category=jackets)
        ItemFactory(tenant=shop, name="Counter Only", category=jackets, website_visible=False)

        rows = APIClient().get(PRODUCTS_URL, **shopfront_host("yak")).json()["data"]
        assert [row["name"] for row in rows] == ["Online"]

        site = APIClient().get(SITE_URL, **shopfront_host("yak")).json()["data"]
        assert site["categories"][0]["product_count"] == 1

    def test_hidden_item_detail_is_404(self) -> None:
        shop = make_shop()
        item = ItemFactory(tenant=shop, website_visible=False)
        response = APIClient().get(
            f"/api/v1/storefront/products/{item.pk}", **shopfront_host("yak")
        )
        assert response.status_code == 404

    def test_featured_products_sort_first_and_filter(self) -> None:
        shop = make_shop()
        ItemFactory(tenant=shop, name="Alpha")
        ItemFactory(tenant=shop, name="Zed", website_featured=True)
        ItemFactory(tenant=shop, name="Mid", website_featured=True)

        rows = APIClient().get(PRODUCTS_URL, **shopfront_host("yak")).json()["data"]
        assert [row["name"] for row in rows] == ["Mid", "Zed", "Alpha"]
        assert rows[0]["featured"] is True
        assert rows[2]["featured"] is False

        featured = APIClient().get(PRODUCTS_URL, {"featured": "1"}, **shopfront_host("yak"))
        assert [row["name"] for row in featured.json()["data"]] == ["Mid", "Zed"]
