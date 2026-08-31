"""Tenant-facing online-store settings API tests."""

from datetime import timedelta
from decimal import Decimal
from typing import Any, cast

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.audit.models import AuditLog
from apps.tenants.models import Tenant, TenantFeatureOverride
from tests.factories import (
    DEFAULT_PASSWORD,
    ItemFactory,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

ROOT = "dokan.com.np"
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
