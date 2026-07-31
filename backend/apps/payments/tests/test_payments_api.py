"""API tests for payments + cash session endpoints."""

from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.inventory.services import post_opening_stock
from apps.payments import services
from apps.sales import services as sale_services
from apps.sales.services import SaleLineInput
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    CustomerFactory,
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
RECEIPTS_URL = "/api/v1/payments/receipts"
PAYMENTS_URL = "/api/v1/payments"


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
    variant = ItemVariantFactory(tenant=tenant, mrp=Decimal("1000.00"))
    post_opening_stock(
        tenant, branch=branch, variant=variant, qty=Decimal("100"),
        unit_cost=Decimal("500.00"), created_by=user,
    )
    customer = CustomerFactory(tenant=tenant, credit_limit=None)
    sale = sale_services.create_sale(
        tenant,
        branch=branch,
        rate_type=rate_type,
        customer=customer,
        lines=[
            SaleLineInput(variant=variant, qty=Decimal("1"), unit_price=None, discount=Decimal("0"))
        ],
        payments=[{"method": "CASH", "amount": Decimal("400.00")}],
        idempotency_key="s-1",
        created_by=user,
    ).invoice
    return {
        "branch": branch,
        "rate_type": rate_type,
        "variant": variant,
        "customer": customer,
        "sale": sale,
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


def receipt_payload(shop: dict, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "branch": str(shop["branch"].pk),
        "customer": str(shop["customer"].pk),
        "amount": "300.00",
        "method": "CASH",
    }
    payload.update(overrides)
    return payload


class TestAuthAndPermissions:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(PAYMENTS_URL, **host()).status_code == 401

    def test_receipt_requires_payment_receive(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.create")
        response = auth_client(user).post(
            RECEIPTS_URL,
            receipt_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="r-1",
        )
        assert response.status_code == 403

    def test_missing_idempotency_key_is_400(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "payment.receive")
        response = auth_client(user).post(
            RECEIPTS_URL, receipt_payload(shop), **host(), format="json"
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"


class TestReceiptFlow:
    def test_create_with_allocation_and_replay(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "payment.receive", "payment.view")
        client = auth_client(user)
        payload = receipt_payload(
            shop,
            allocations=[{"invoice": str(shop["sale"].pk), "amount": "300.00"}],
        )
        first = client.post(
            RECEIPTS_URL, payload, **host(), format="json", HTTP_IDEMPOTENCY_KEY="r-1"
        )
        assert first.status_code == 201
        data = first.json()["data"]
        assert data["direction"] == "RECEIPT"
        assert data["allocations"][0]["amount"] == "300.00"

        second = client.post(
            RECEIPTS_URL, payload, **host(), format="json", HTTP_IDEMPOTENCY_KEY="r-1"
        )
        assert second.status_code == 200
        assert second.headers.get("X-Idempotent-Replay") == "true"
        assert second.json()["data"]["id"] == data["id"]

    def test_over_allocation_is_400(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "payment.receive")
        response = auth_client(user).post(
            RECEIPTS_URL,
            receipt_payload(
                shop,
                amount="700.00",
                allocations=[{"invoice": str(shop["sale"].pk), "amount": "700.00"}],
            ),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="r-over",
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "ALLOCATION_EXCEEDS_OUTSTANDING"


class TestListAndLedgers:
    def test_payments_list_filters(self, tenant: Any, user: Any, shop: dict) -> None:
        services.record_receipt(
            tenant,
            branch=shop["branch"],
            customer=shop["customer"],
            amount=Decimal("300.00"),
            method="CASH",
            idempotency_key="r-1",
            created_by=user,
        )
        grant(tenant, user, "payment.view")
        client = auth_client(user)

        all_payments = client.get(PAYMENTS_URL, **host())
        assert all_payments.json()["meta"]["count"] == 1

        by_method = client.get(PAYMENTS_URL, {"method": "ESEWA"}, **host())
        assert by_method.json()["meta"]["count"] == 0

        by_customer = client.get(PAYMENTS_URL, {"customer": str(shop["customer"].pk)}, **host())
        assert by_customer.json()["meta"]["count"] == 1

    def test_customer_ledger_endpoint(self, tenant: Any, user: Any, shop: dict) -> None:
        services.record_receipt(
            tenant,
            branch=shop["branch"],
            customer=shop["customer"],
            amount=Decimal("300.00"),
            method="CASH",
            idempotency_key="r-1",
            created_by=user,
        )
        grant(tenant, user, "customer.view")
        response = auth_client(user).get(
            f"/api/v1/customers/{shop['customer'].pk}/ledger", **host()
        )
        assert response.status_code == 200
        rows = response.json()["data"]
        assert [row["kind"] for row in rows] == ["OPENING", "SALE", "RECEIPT"]
        assert rows[-1]["balance"] == "300.00"

    def test_aging_endpoint(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "payment.view")
        response = auth_client(user).get("/api/v1/payments/reports/receivables-aging", **host())
        assert response.status_code == 200
        rows = response.json()["data"]
        assert len(rows) == 1
        assert rows[0]["buckets"]["0-30"] == "600.00"


class TestCashSessionApi:
    def test_open_current_close_flow(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "cash.manage")
        client = auth_client(user)

        opened = client.post(
            "/api/v1/cash-sessions/open",
            {"branch": str(shop["branch"].pk), "opening_float": "1000.00"},
            **host(),
            format="json",
        )
        assert opened.status_code == 201
        session_id = opened.json()["data"]["id"]

        current = client.get(
            "/api/v1/cash-sessions/current", {"branch": str(shop["branch"].pk)}, **host()
        )
        assert current.json()["data"]["session"]["id"] == session_id

        closed = client.post(
            f"/api/v1/cash-sessions/{session_id}/close",
            {"counted_cash": "1600.00"},
            **host(),
            format="json",
        )
        assert closed.status_code == 200
        data = closed.json()["data"]
        # The fixture sale predates the session open (out of window), so
        # expected is just the opening float.
        assert data["expected_cash"] == "1000.00"
        assert data["variance"] == "600.00"

        current_after = client.get(
            "/api/v1/cash-sessions/current", {"branch": str(shop["branch"].pk)}, **host()
        )
        assert current_after.json()["data"]["session"] is None

    def test_current_requires_branch_param(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "cash.manage")
        response = auth_client(user).get("/api/v1/cash-sessions/current", **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "BRANCH_REQUIRED"

    def test_open_requires_cash_manage(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.create")
        response = auth_client(user).post(
            "/api/v1/cash-sessions/open",
            {"branch": str(shop["branch"].pk), "opening_float": "100.00"},
            **host(),
            format="json",
        )
        assert response.status_code == 403
