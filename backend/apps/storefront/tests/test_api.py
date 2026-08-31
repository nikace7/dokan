"""Public storefront API tests — host resolution, plan gate, cost-safe payloads."""

from datetime import timedelta
from decimal import Decimal
from typing import Any, cast

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.audit.models import AuditLog
from apps.storefront.selectors import extract_shopfront_label
from apps.tenants.models import Tenant, TenantFeatureOverride
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    CategoryFactory,
    ItemFactory,
    ItemVariantFactory,
    RoleFactory,
    RolePermissionFactory,
    StockLevelFactory,
    StoreSettingsFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
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
                "website_price",
                "website_compare_at",
                "offer_pct",
                "featured",
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


class TestStoreContent:
    """Dynamic store settings flow into the public site + product payloads."""

    def test_site_defaults_when_unconfigured(self) -> None:
        make_shop(currency="INR")
        data = APIClient().get(SITE_URL, **shopfront_host("yak")).json()["data"]
        assert data["currency"] == "INR"
        assert data["store"] == {
            "hero_title": "",
            "hero_subtitle": "",
            "announcement": "",
            "offer_text": "",
            "offer_discount_pct": None,
            "offer_ends_at": None,
            "popup": None,
            "banners": [],
        }

    def test_site_uses_store_content_and_currency(self) -> None:
        shop = make_shop(currency="INR")
        StoreSettingsFactory(
            tenant=shop,
            hero_title="Winter Drop",
            announcement="Free alteration this week",
            offer_text="Tihar Sale",
            offer_discount_pct=Decimal("20.00"),
            currency="NPR",
        )

        data = APIClient().get(SITE_URL, **shopfront_host("yak")).json()["data"]

        assert data["currency"] == "NPR"  # website currency wins for display
        assert data["store"]["hero_title"] == "Winter Drop"
        assert data["store"]["announcement"] == "Free alteration this week"
        assert data["store"]["offer_text"] == "Tihar Sale"
        assert data["store"]["offer_discount_pct"] == "20.00"

    def test_website_price_replaces_range_and_offer_discounts_it(self) -> None:
        shop = make_shop()
        StoreSettingsFactory(tenant=shop, offer_discount_pct=Decimal("25.00"))
        ItemFactory(
            tenant=shop,
            name="Puffer",
            min_selling_price=Decimal("800.00"),
            max_selling_price=Decimal("1600.00"),
            website_price=Decimal("1200.00"),
        )

        rows = APIClient().get(PRODUCTS_URL, **shopfront_host("yak")).json()["data"]

        assert rows[0]["website_price"] == "900.00"  # 1200 − 25%
        assert rows[0]["website_compare_at"] == "1200.00"
        assert rows[0]["price_min"] == "800.00"  # range stays the counter reference

    def test_website_price_without_offer_has_no_compare_at(self) -> None:
        shop = make_shop()
        ItemFactory(tenant=shop, name="Cap", website_price=Decimal("500.00"))

        rows = APIClient().get(PRODUCTS_URL, **shopfront_host("yak")).json()["data"]

        assert rows[0]["website_price"] == "500.00"
        assert rows[0]["website_compare_at"] is None

    def test_range_converts_to_store_currency_at_the_peg(self) -> None:
        shop = make_shop(currency="INR")
        StoreSettingsFactory(tenant=shop, currency="NPR")
        ItemFactory(
            tenant=shop,
            name="Shawl",
            min_selling_price=Decimal("100.00"),
            max_selling_price=Decimal("200.00"),
        )

        rows = APIClient().get(PRODUCTS_URL, **shopfront_host("yak")).json()["data"]

        assert rows[0]["price_min"] == "160.00"  # INR → NPR at the 1.6 peg
        assert rows[0]["price_max"] == "320.00"

    def test_per_product_offer_beats_the_store_wide_offer(self) -> None:
        shop = make_shop()
        StoreSettingsFactory(tenant=shop, offer_discount_pct=Decimal("25.00"))
        ItemFactory(
            tenant=shop,
            name="Own Offer",
            website_price=Decimal("1000.00"),
            website_discount_pct=Decimal("10.00"),
        )
        ItemFactory(tenant=shop, name="Store Offer", website_price=Decimal("1000.00"))

        response = APIClient().get(PRODUCTS_URL, **shopfront_host("yak"))
        rows = {row["name"]: row for row in response.json()["data"]}

        assert rows["Own Offer"]["website_price"] == "900.00"  # 10%, not 25%
        assert rows["Own Offer"]["offer_pct"] == "10.00"
        assert rows["Store Offer"]["website_price"] == "750.00"
        assert rows["Store Offer"]["offer_pct"] == "25.00"

    def test_expired_store_offer_stops_discounting(self) -> None:
        shop = make_shop()
        StoreSettingsFactory(
            tenant=shop,
            offer_text="Old Sale",
            offer_discount_pct=Decimal("50.00"),
            offer_ends_at=timezone.localdate() - timedelta(days=1),
        )
        ItemFactory(tenant=shop, name="Puffer", website_price=Decimal("2000.00"))

        site = APIClient().get(SITE_URL, **shopfront_host("yak")).json()["data"]["store"]
        assert site["offer_text"] == ""
        assert site["offer_discount_pct"] is None
        assert site["offer_ends_at"] is None

        rows = APIClient().get(PRODUCTS_URL, **shopfront_host("yak")).json()["data"]
        assert rows[0]["website_price"] == "2000.00"
        assert rows[0]["website_compare_at"] is None
        assert rows[0]["offer_pct"] is None

    def test_live_offer_exposes_its_end_date(self) -> None:
        shop = make_shop()
        ends = timezone.localdate() + timedelta(days=5)
        StoreSettingsFactory(
            tenant=shop,
            offer_text="Week Deal",
            offer_discount_pct=Decimal("15.00"),
            offer_ends_at=ends,
        )

        site = APIClient().get(SITE_URL, **shopfront_host("yak")).json()["data"]["store"]
        assert site["offer_text"] == "Week Deal"
        assert site["offer_discount_pct"] == "15.00"
        assert site["offer_ends_at"] == ends.isoformat()

    def test_site_exposes_popup_and_banners(self) -> None:
        shop = make_shop()
        StoreSettingsFactory(
            tenant=shop,
            popup_enabled=True,
            popup_title="Namaste!",
            popup_text="10% off your first order",
            popup_cta_text="Shop now",
            popup_cta_link="#shop",
            banners=[
                {
                    "title": "Free delivery",
                    "text": "Inside the valley",
                    "cta_text": "",
                    "cta_link": "",
                }
            ],
        )

        store = APIClient().get(SITE_URL, **shopfront_host("yak")).json()["data"]["store"]
        assert store["popup"] == {
            "title": "Namaste!",
            "text": "10% off your first order",
            "cta_text": "Shop now",
            "cta_link": "#shop",
        }
        assert store["banners"] == [
            {"title": "Free delivery", "text": "Inside the valley", "cta_text": "", "cta_link": ""}
        ]

    def test_disabled_or_empty_popup_stays_hidden(self) -> None:
        shop = make_shop()
        StoreSettingsFactory(tenant=shop, popup_enabled=True)  # enabled but no copy
        store = APIClient().get(SITE_URL, **shopfront_host("yak")).json()["data"]["store"]
        assert store["popup"] is None


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


SETTINGS_URL = "/api/v1/storefront/settings"


def pos_host(slug: str) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.{ROOT}"}


def grant(tenant: Any, user: Any, *codes: str) -> None:
    role = RoleFactory(tenant=tenant)
    for code in codes:
        RolePermissionFactory(
            tenant=tenant, role=role, permission=Permission.objects.get(code=code)
        )
    UserRoleFactory(tenant=tenant, user=user, role=role)


def auth_client(user: Any, slug: str) -> APIClient:
    tokens = (
        APIClient()
        .post(
            "/api/v1/auth/token",
            {"phone": user.phone, "password": DEFAULT_PASSWORD},
            **pos_host(slug),
        )
        .json()["data"]
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return client


class TestStoreSettingsApi:
    def test_unauthenticated_is_401(self) -> None:
        tenant = TenantFactory()
        assert APIClient().get(SETTINGS_URL, **pos_host(tenant.slug)).status_code == 401

    def test_missing_settings_manage_is_403(self) -> None:
        tenant = TenantFactory()
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "sale.create")
        client = auth_client(user, tenant.slug)
        assert client.get(SETTINGS_URL, **pos_host(tenant.slug)).status_code == 403

    def test_get_returns_defaults_plus_platform_readings(self) -> None:
        tenant = cast(
            "Tenant", TenantFactory(shopfront_subdomain="yak", shopfront_template="bazaar")
        )
        TenantFeatureOverride.objects.create(tenant=tenant, key="features.ecommerce", value=True)
        ItemFactory(tenant=tenant, website_price=Decimal("900.00"))
        ItemFactory(tenant=tenant)
        ItemFactory(tenant=tenant, is_active=False, website_price=Decimal("100.00"))
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "settings.manage")

        data = (
            auth_client(user, tenant.slug).get(SETTINGS_URL, **pos_host(tenant.slug)).json()["data"]
        )

        assert data["hero_title"] == ""
        assert data["offer_discount_pct"] is None
        assert data["currency"] == "NPR"
        assert data["shopfront_subdomain"] == "yak"
        assert data["template"] == "bazaar"
        assert data["store_url"] == f"https://yak.shop.{ROOT}"
        assert data["ecommerce_enabled"] is True
        assert data["active_items_count"] == 2
        assert data["website_price_count"] == 1

    def test_patch_updates_and_audits(self) -> None:
        tenant = TenantFactory()
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "settings.manage")
        client = auth_client(user, tenant.slug)

        response = client.patch(
            SETTINGS_URL,
            {
                "hero_title": "Dashain Collection",
                "offer_text": "Dashain Sale",
                "offer_discount_pct": "15.00",
                "currency": "INR",
            },
            format="json",
            **pos_host(tenant.slug),
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["hero_title"] == "Dashain Collection"
        assert data["offer_discount_pct"] == "15.00"
        assert data["currency"] == "INR"
        entry = AuditLog.objects.get(tenant=tenant, action="store.settings.update")
        after = cast("dict[str, Any]", entry.after)
        assert after["hero_title"] == "Dashain Collection"

    def test_patch_rejects_out_of_range_discount(self) -> None:
        tenant = TenantFactory()
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "settings.manage")

        response = auth_client(user, tenant.slug).patch(
            SETTINGS_URL,
            {"offer_discount_pct": "95.00"},
            format="json",
            **pos_host(tenant.slug),
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "DISCOUNT_OUT_OF_RANGE"

    def test_patch_popup_banners_and_offer_end_date(self) -> None:
        tenant = TenantFactory()
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "settings.manage")
        client = auth_client(user, tenant.slug)
        ends = (timezone.localdate() + timedelta(days=10)).isoformat()

        response = client.patch(
            SETTINGS_URL,
            {
                "popup_enabled": True,
                "popup_title": "Namaste!",
                "popup_text": "First order treat",
                "popup_cta_text": "Shop now",
                "popup_cta_link": "#shop",
                "offer_ends_at": ends,
                "banners": [{"title": "Free delivery", "text": "Inside Ring Road"}],
            },
            format="json",
            **pos_host(tenant.slug),
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["popup_enabled"] is True
        assert data["popup_cta_link"] == "#shop"
        assert data["offer_ends_at"] == ends
        # Missing optional keys normalise to empty strings.
        assert data["banners"] == [
            {"title": "Free delivery", "text": "Inside Ring Road", "cta_text": "", "cta_link": ""}
        ]
        entry = AuditLog.objects.get(tenant=tenant, action="store.settings.update")
        after = cast("dict[str, Any]", entry.after)
        assert after["popup_enabled"] is True
        assert after["banners"][0]["title"] == "Free delivery"

    def test_patch_rejects_bad_banners(self) -> None:
        tenant = TenantFactory()
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "settings.manage")
        client = auth_client(user, tenant.slug)

        too_many = client.patch(
            SETTINGS_URL,
            {"banners": [{"title": f"B{n}"} for n in range(6)]},
            format="json",
            **pos_host(tenant.slug),
        )
        assert too_many.status_code == 400
        assert too_many.json()["error"]["code"] == "BANNERS_INVALID"

        no_title = client.patch(
            SETTINGS_URL,
            {"banners": [{"text": "oops"}]},
            format="json",
            **pos_host(tenant.slug),
        )
        assert no_title.status_code == 400
        assert no_title.json()["error"]["code"] == "BANNERS_INVALID"

        bad_link = client.patch(
            SETTINGS_URL,
            {"banners": [{"title": "X", "cta_link": "javascript:alert(1)"}]},
            format="json",
            **pos_host(tenant.slug),
        )
        assert bad_link.status_code == 400
        assert bad_link.json()["error"]["code"] == "LINK_INVALID"

    def test_patch_rejects_unsafe_popup_link(self) -> None:
        tenant = TenantFactory()
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "settings.manage")

        response = auth_client(user, tenant.slug).patch(
            SETTINGS_URL,
            {"popup_cta_link": "javascript:alert(1)"},
            format="json",
            **pos_host(tenant.slug),
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "LINK_INVALID"
