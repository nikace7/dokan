"""API tests for returns/exchanges/returnable/outstanding endpoints."""

from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.inventory.services import post_opening_stock
from apps.sales import services
from apps.sales.services import SaleLineInput
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    CustomerFactory,
    ItemFactory,
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
RETURNS_URL = "/api/v1/sales/returns"
EXCHANGES_URL = "/api/v1/sales/exchanges"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug=SLUG)


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


@pytest.fixture
def shop(tenant: Any, user: Any) -> dict[str, Any]:
    branch = BranchFactory(tenant=tenant)
    rate_type = RateTypeFactory(tenant=tenant, is_default=True)
    variant = ItemVariantFactory(
        tenant=tenant, item=ItemFactory(tenant=tenant), mrp=Decimal("1000.00")
    )
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        qty=Decimal("10"),
        unit_cost=Decimal("600.00"),
        created_by=user,
    )
    customer = CustomerFactory(tenant=tenant, credit_limit=None)
    original = services.create_sale(
        tenant,
        branch=branch,
        rate_type=rate_type,
        customer=customer,
        lines=[
            SaleLineInput(variant=variant, qty=Decimal("2"), unit_price=None, discount=Decimal("0"))
        ],
        payments=[{"method": "CASH", "amount": Decimal("1500.00")}],
        idempotency_key="sale-1",
        created_by=user,
    ).invoice
    return {
        "branch": branch,
        "rate_type": rate_type,
        "variant": variant,
        "customer": customer,
        "original": original,
    }


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


def return_payload(shop: dict, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "original_invoice": str(shop["original"].pk),
        "lines": [{"variant": str(shop["variant"].pk), "qty": "1"}],
        "reason": "Wrong size",
    }
    payload.update(overrides)
    return payload


class TestAuthAndPermissions:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().post(RETURNS_URL, {}, **host(), format="json").status_code == 401

    def test_missing_sale_return_permission_is_403(
        self, tenant: Any, user: Any, shop: dict
    ) -> None:
        grant(tenant, user, "sale.create")
        response = auth_client(user).post(
            RETURNS_URL,
            return_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="r-1",
        )
        assert response.status_code == 403

    def test_missing_idempotency_key_is_400(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.return")
        response = auth_client(user).post(
            RETURNS_URL, return_payload(shop), **host(), format="json"
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"


class TestReturnApi:
    def test_create_and_replay(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.return", "sale.view")
        client = auth_client(user)
        first = client.post(
            RETURNS_URL,
            return_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="r-1",
        )
        assert first.status_code == 201
        data = first.json()["data"]
        assert data["doc_type"] == "RETURN"
        assert data["total"] == "1000.00"

        second = client.post(
            RETURNS_URL,
            return_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="r-1",
        )
        assert second.status_code == 200
        assert second.json()["data"]["id"] == data["id"]

    def test_over_return_is_400(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.return")
        response = auth_client(user).post(
            RETURNS_URL,
            return_payload(shop, lines=[{"variant": str(shop["variant"].pk), "qty": "99"}]),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="r-over",
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "OVER_RETURN"

    def test_credit_note_refund_flow(self, tenant: Any, user: Any, shop: dict) -> None:
        """Original due is 500; credit note 300 + cash refund for the rest."""
        grant(tenant, user, "sale.return", "customer.view")
        client = auth_client(user)
        response = client.post(
            RETURNS_URL,
            return_payload(
                shop,
                refunds=[
                    {"method": "CREDIT_NOTE", "amount": "300.00"},
                    {"method": "CASH", "amount": "700.00"},
                ],
            ),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="r-cn",
        )
        assert response.status_code == 201

        outstanding = client.get(f"/api/v1/customers/{shop['customer'].pk}/outstanding", **host())
        assert outstanding.status_code == 200
        data = outstanding.json()["data"]
        assert data["due_amount"] == "500.00"
        assert data["credit_notes"] == "300.00"
        assert data["outstanding"] == "200.00"


class TestReturnableApi:
    def test_remaining_quantities(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.view", "sale.return")
        client = auth_client(user)
        client.post(
            RETURNS_URL,
            return_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="r-1",
        )
        response = client.get(f"/api/v1/sales/{shop['original'].pk}/returnable", **host())
        assert response.status_code == 200
        line = response.json()["data"][0]
        assert line["qty"] == "2.000"
        assert line["returned_qty"] == "1.000"
        assert line["remaining"] == "1.000"

    def test_returnable_on_return_doc_is_409(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.view", "sale.return")
        client = auth_client(user)
        created = client.post(
            RETURNS_URL,
            return_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="r-1",
        )
        return_id = created.json()["data"]["id"]
        response = client.get(f"/api/v1/sales/{return_id}/returnable", **host())
        assert response.status_code == 409


class TestExchangeApi:
    def test_exchange_happy_path(self, tenant: Any, user: Any, shop: dict) -> None:
        other_variant = ItemVariantFactory(tenant=tenant, mrp=Decimal("1200.00"))
        post_opening_stock(
            tenant,
            branch=shop["branch"],
            variant=other_variant,
            qty=Decimal("5"),
            unit_cost=Decimal("700.00"),
            created_by=user,
        )
        grant(tenant, user, "sale.return", "sale.view")
        response = auth_client(user).post(
            EXCHANGES_URL,
            {
                "original_invoice": str(shop["original"].pk),
                "returned_lines": [{"variant": str(shop["variant"].pk), "qty": "1"}],
                "new_lines": [{"variant": str(other_variant.pk), "qty": "1"}],
                "payments": [{"method": "CASH", "amount": "200.00"}],
                "reason": "Wrong size",
            },
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="ex-1",
        )
        assert response.status_code == 201
        data = response.json()["data"]
        assert data["sale_invoice"]["doc_type"] == "SALE"
        assert data["return_invoice"]["doc_type"] == "RETURN"
        assert data["refund_amount"] == "0.00"
        assert data["sale_invoice"]["paid_amount"] == "1200.00"
