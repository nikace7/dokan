"""Ordering flow tests — OTP login, checkout, tracking, order history."""

import re
from decimal import Decimal
from typing import Any, cast

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.storefront.models import StoreCustomer, StoreOrder, StoreOtp
from apps.storefront.tests.test_api import make_shop, shopfront_host
from tests.factories import (
    BranchFactory,
    ItemFactory,
    ItemVariantFactory,
    StockLevelFactory,
    StoreCustomerFactory,
    StoreOrderFactory,
    StoreSettingsFactory,
)

pytestmark = pytest.mark.django_db

DETAIL_URL = "/api/v1/storefront/products/{pk}"
OTP_URL = "/api/v1/storefront/auth/otp"
VERIFY_URL = "/api/v1/storefront/auth/verify"
ORDERS_URL = "/api/v1/storefront/orders"
TRACK_URL = "/api/v1/storefront/orders/{token}"
MY_ORDERS_URL = "/api/v1/storefront/my/orders"


def make_sellable(shop: Any, **item_kwargs: Any) -> Any:
    BranchFactory(tenant=shop, is_default=True)
    item = ItemFactory(tenant=shop, **item_kwargs)
    variant = ItemVariantFactory(tenant=shop, item=item)
    StockLevelFactory(tenant=shop, variant=variant, qty_on_hand=Decimal("10"))
    return variant


def checkout_payload(variant: Any, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "customer": {"email": "sita@example.com", "full_name": "Sita Rai", "phone": "9811111111"},
        "fulfillment": "PICKUP",
        "payment_method": "COD",
        "items": [{"variant": str(variant.pk), "qty": "2"}],
    }
    payload.update(overrides)
    return payload


def post_order(payload: dict[str, Any], key: str = "order-key-1") -> Any:
    return APIClient().post(
        ORDERS_URL,
        payload,
        format="json",
        HTTP_IDEMPOTENCY_KEY=key,
        **shopfront_host("yak"),
    )


class TestProductDetail:
    def test_detail_lists_variants_with_stock_and_price(self) -> None:
        shop = make_shop()
        StoreSettingsFactory(tenant=shop, offer_discount_pct=Decimal("50.00"))
        variant = make_sellable(shop, name="Puffer", website_price=Decimal("2000.00"))

        response = APIClient().get(
            DETAIL_URL.format(pk=variant.item_id), **shopfront_host("yak")
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["name"] == "Puffer"
        assert data["website_price"] == "1000.00"
        assert data["website_compare_at"] == "2000.00"
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
            VERIFY_URL, {"email": "a@b.com", "code": "000000"}, format="json",
            **shopfront_host("yak"),
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "OTP_INVALID"

    def test_verify_mints_a_token_and_creates_the_customer(self) -> None:
        shop = make_shop()
        code = self._request_and_read_code("new@shopper.com")

        response = APIClient().post(
            VERIFY_URL, {"email": "new@shopper.com", "code": code}, format="json",
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
            VERIFY_URL, {"email": "a@b.com", "code": code}, format="json",
            **shopfront_host("yak"),
        )
        assert response.status_code == 400


class TestCheckout:
    def test_missing_idempotency_key_is_400(self) -> None:
        shop = make_shop()
        variant = make_sellable(shop, website_price=Decimal("1000.00"))
        response = APIClient().post(
            ORDERS_URL, checkout_payload(variant), format="json", **shopfront_host("yak")
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "MISSING_IDEMPOTENCY_KEY"

    def test_delivery_requires_an_address(self) -> None:
        shop = make_shop()
        variant = make_sellable(shop, website_price=Decimal("1000.00"))
        response = post_order(checkout_payload(variant, fulfillment="DELIVERY"))
        assert response.status_code == 400

    def test_pickup_cod_order_with_offer_pricing(self) -> None:
        shop = make_shop()
        StoreSettingsFactory(
            tenant=shop, offer_text="Winter Sale", offer_discount_pct=Decimal("10.00")
        )
        variant = make_sellable(shop, name="Puffer", website_price=Decimal("2000.00"))

        response = post_order(checkout_payload(variant))

        assert response.status_code == 201
        data = response.json()["data"]
        assert data["number_text"] == "ORD-000001"
        assert data["status"] == "PLACED"
        assert data["fulfillment"] == "PICKUP"
        assert data["payment_method"] == "COD"
        assert data["payment_status"] == "PENDING"
        assert data["currency"] == "NPR"
        assert data["offer_text"] == "Winter Sale"
        assert data["subtotal"] == "3600.00"  # 2 × (2000 − 10%)
        assert data["total"] == "3600.00"
        assert data["items"][0]["unit_price"] == "1800.00"
        assert data["items"][0]["compare_at"] == "2000.00"
        # The customer was auto-created on their first order, and emailed.
        assert StoreCustomer.objects.filter(tenant=shop, email="sita@example.com").exists()
        assert any("ORD-000001" in m.subject for m in mail.outbox)

    def test_idempotent_replay_returns_the_original(self) -> None:
        shop = make_shop()
        variant = make_sellable(shop, website_price=Decimal("1000.00"))
        first = post_order(checkout_payload(variant), key="same-key")
        second = post_order(checkout_payload(variant), key="same-key")

        assert first.status_code == 201
        assert second.status_code == 200
        assert first.json()["data"]["tracking_token"] == second.json()["data"]["tracking_token"]
        assert StoreOrder.objects.count() == 1

    def test_unknown_variant_is_409(self) -> None:
        make_shop()
        variant = make_sellable(make_shop(slug="other-pos", shopfront="other"))
        response = post_order(checkout_payload(variant))
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "VARIANT_NOT_FOUND"

    def test_insufficient_stock_is_409(self) -> None:
        shop = make_shop()
        variant = make_sellable(shop, website_price=Decimal("1000.00"))
        lines = [{"variant": str(variant.pk), "qty": "99"}]
        response = post_order(checkout_payload(variant, items=lines))
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "OUT_OF_STOCK"

    def test_price_fallback_to_min_selling_price(self) -> None:
        shop = make_shop(currency="INR")
        StoreSettingsFactory(tenant=shop, currency="NPR")  # display in NPR
        variant = make_sellable(shop, min_selling_price=Decimal("100.00"))  # INR

        response = post_order(checkout_payload(variant))

        assert response.status_code == 201
        data = response.json()["data"]
        assert data["currency"] == "NPR"
        assert data["items"][0]["unit_price"] == "160.00"  # peg-converted
        assert data["items"][0]["compare_at"] is None

    def test_missing_price_is_409(self) -> None:
        shop = make_shop()
        variant = make_sellable(shop)  # no website price, no min price
        response = post_order(checkout_payload(variant))
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "PRICE_NOT_SET"

    def test_delivery_snapshots_address_and_updates_profile(self) -> None:
        shop = make_shop()
        variant = make_sellable(shop, website_price=Decimal("1000.00"))
        address = {
            "line1": "MG Marg, Ward 5",
            "city": "Gangtok",
            "lat": "27.331400",
            "lng": "88.613800",
        }

        response = post_order(checkout_payload(variant, fulfillment="DELIVERY", address=address))

        assert response.status_code == 201
        data = response.json()["data"]
        assert data["address"]["line1"] == "MG Marg, Ward 5"
        customer = StoreCustomer.objects.get(tenant=shop, email="sita@example.com")
        default_address = cast("dict[str, Any]", customer.default_address)
        assert default_address["city"] == "Gangtok"
        assert customer.full_name == "Sita Rai"


class TestTrackingAndHistory:
    def _place(self, shop: Any) -> Any:
        variant = make_sellable(shop, website_price=Decimal("1000.00"))
        response = post_order(checkout_payload(variant))
        assert response.status_code == 201
        return response.json()["data"]

    def test_tracking_by_token(self) -> None:
        shop = make_shop()
        placed = self._place(shop)

        response = APIClient().get(
            TRACK_URL.format(token=placed["tracking_token"]), **shopfront_host("yak")
        )

        assert response.status_code == 200
        assert response.json()["data"]["number_text"] == placed["number_text"]

    def test_unknown_tracking_token_is_404(self) -> None:
        make_shop()
        response = APIClient().get(
            TRACK_URL.format(token="018f3f3f-3f3f-3f3f-3f3f-3f3f3f3f3f3f"),
            **shopfront_host("yak"),
        )
        assert response.status_code == 404

    def test_my_orders_requires_login(self) -> None:
        make_shop()
        assert APIClient().get(MY_ORDERS_URL, **shopfront_host("yak")).status_code == 401

    def test_my_orders_returns_only_the_shoppers_orders(self) -> None:
        shop = make_shop()
        mine = StoreCustomerFactory(tenant=shop, email="mine@example.com")
        other = StoreCustomerFactory(tenant=shop, email="other@example.com")
        StoreOrderFactory(tenant=shop, customer=mine, number_text="ORD-000001", order_number=1)
        StoreOrderFactory(tenant=shop, customer=other, number_text="ORD-000002", order_number=2)
        BranchFactory(tenant=shop, is_default=True)

        # Log in as mine@example.com via OTP.
        APIClient().post(
            OTP_URL, {"email": "mine@example.com"}, format="json", **shopfront_host("yak")
        )
        code = re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)
        token = (
            APIClient()
            .post(
                VERIFY_URL,
                {"email": "mine@example.com", "code": code},
                format="json",
                **shopfront_host("yak"),
            )
            .json()["data"]["token"]
        )

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = client.get(MY_ORDERS_URL, **shopfront_host("yak"))

        assert response.status_code == 200
        numbers = [row["number_text"] for row in response.json()["data"]]
        assert numbers == ["ORD-000001"]
