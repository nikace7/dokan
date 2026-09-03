"""Storefront product-detail and shopper email-OTP tests."""

import re
from decimal import Decimal

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.storefront.models import StoreCustomer, StoreOtp
from apps.storefront.tests.test_api import make_shop, shopfront_host
from apps.storefront.tests.test_orders import make_sellable
from tests.factories import StoreSettingsFactory

pytestmark = pytest.mark.django_db

DETAIL_URL = "/api/v1/storefront/products/{pk}"
OTP_URL = "/api/v1/storefront/auth/otp"
VERIFY_URL = "/api/v1/storefront/auth/verify"


class TestProductDetail:
    def test_detail_lists_variants_with_stock_and_price(self) -> None:
        shop = make_shop()
        StoreSettingsFactory(tenant=shop, offer_discount_pct=Decimal("50.00"))
        variant = make_sellable(shop, name="Puffer", website_price=Decimal("2000.00"))

        response = APIClient().get(DETAIL_URL.format(pk=variant.item_id), **shopfront_host("yak"))

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["name"] == "Puffer"
        assert data["website_price"] == "1000.00"
        assert data["website_compare_at"] == "2000.00"
        assert data["offer_pct"] == "50.00"
        assert data["variants"] == [
            {
                "id": str(variant.pk),
                "size": variant.size,
                "color": variant.color,
                "sku": variant.sku,
                "in_stock": True,
                "price": "1000.00",
                "compare_at": "2000.00",
            }
        ]

    def test_detail_uses_variant_minimum_when_no_website_price_exists(self) -> None:
        shop = make_shop()
        variant = make_sellable(shop, name="Everyday Tee")
        variant.min_selling_price = Decimal("850.00")
        variant.save(update_fields=["min_selling_price", "updated_at"])

        response = APIClient().get(DETAIL_URL.format(pk=variant.item_id), **shopfront_host("yak"))

        assert response.status_code == 200
        assert response.json()["data"]["variants"][0]["price"] == "850.00"

    def test_unknown_product_is_404(self) -> None:
        make_shop()
        response = APIClient().get(
            DETAIL_URL.format(pk="018f3f3f-3f3f-3f3f-3f3f-3f3f3f3f3f3f"),
            **shopfront_host("yak"),
        )
        assert response.status_code == 404


class TestOtpLogin:
    def test_request_sends_a_code_email(self) -> None:
        make_shop()
        response = APIClient().post(
            OTP_URL, {"email": "Sita@Example.com"}, format="json", **shopfront_host("yak")
        )
        assert response.status_code == 200
        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ["sita@example.com"]
        code = re.search(r"\b(\d{6})\b", mail.outbox[0].body).group(1)
        assert StoreOtp.objects.filter(email="sita@example.com").count() == 1
        assert code

    def test_resend_cooldown(self) -> None:
        make_shop()
        APIClient().post(OTP_URL, {"email": "a@b.com"}, format="json", **shopfront_host("yak"))
        response = APIClient().post(
            OTP_URL, {"email": "a@b.com"}, format="json", **shopfront_host("yak")
        )
        assert response.status_code == 429
        assert response.json()["error"]["code"] == "OTP_RESEND_TOO_SOON"

    def _request_and_read_code(self, email: str) -> str:
        APIClient().post(OTP_URL, {"email": email}, format="json", **shopfront_host("yak"))
        return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)

    def test_verify_rejects_a_wrong_code(self) -> None:
        make_shop()
        self._request_and_read_code("a@b.com")
        response = APIClient().post(
            VERIFY_URL,
            {"email": "a@b.com", "code": "000000"},
            format="json",
            **shopfront_host("yak"),
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "OTP_INVALID"

    def test_verify_mints_a_token_and_creates_the_customer(self) -> None:
        shop = make_shop()
        code = self._request_and_read_code("new@shopper.com")

        response = APIClient().post(
            VERIFY_URL,
            {"email": "new@shopper.com", "code": code},
            format="json",
            **shopfront_host("yak"),
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["token"]
        assert data["customer"]["email"] == "new@shopper.com"
        assert StoreCustomer.objects.filter(tenant=shop, email="new@shopper.com").exists()

    def test_expired_code_is_invalid(self) -> None:
        make_shop()
        code = self._request_and_read_code("a@b.com")
        StoreOtp.objects.update(expires_at=timezone.now())
        response = APIClient().post(
            VERIFY_URL,
            {"email": "a@b.com", "code": code},
            format="json",
            **shopfront_host("yak"),
        )
        assert response.status_code == 400
