"""API tests for sales endpoints — happy path, auth-denied, idempotency,
cost visibility on lines, and the hold/complete/cancel flow.
"""

from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.inventory.services import post_opening_stock
from apps.payments import services as payment_services
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    ItemFactory,
    ItemVariantFactory,
    RateTypeFactory,
    RoleFactory,
    RolePermissionFactory,
    SalesInvoiceFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
SALES_URL = "/api/v1/sales"


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
    item = ItemFactory(tenant=tenant)
    variant = ItemVariantFactory(tenant=tenant, item=item, mrp=Decimal("1000.00"))
    post_opening_stock(
        tenant,
        branch=branch,
        variant=variant,
        qty=Decimal("20"),
        unit_cost=Decimal("600.00"),
        created_by=user,
    )
    payment_services.open_session(
        tenant,
        branch=branch,
        opening_float=Decimal("0.00"),
        opened_by=user,
    )
    return {"branch": branch, "rate_type": rate_type, "variant": variant}


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


def sale_payload(shop: dict, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "branch": str(shop["branch"].pk),
        "rate_type": str(shop["rate_type"].pk),
        "lines": [{"variant": str(shop["variant"].pk), "qty": "2"}],
        "payments": [{"method": "CASH", "amount": "2000.00"}],
    }
    payload.update(overrides)
    return payload


class TestHoldCompleteCancelFlow:
    def test_full_flow(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.view", "sale.create", "sale.void")
        client = auth_client(user)

        held = client.post(
            f"{SALES_URL}/hold",
            sale_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="hold-1",
        )
        assert held.status_code == 201
        held_data = held.json()["data"]
        assert held_data["status"] == "HELD"
        assert held_data["invoice_no"] is None

        held_list = client.get(f"{SALES_URL}/held", **host())
        assert held_list.json()["meta"]["count"] == 1

        completed = client.post(
            f"{SALES_URL}/{held_data['id']}/complete",
            {"payments": [{"method": "CASH", "amount": "2000.00"}]},
            **host(),
            format="json",
        )
        assert completed.status_code == 200
        assert completed.json()["data"]["status"] == "COMPLETED"
        assert completed.json()["data"]["invoice_no"] == 1

        # A second held bill can be cancelled with sale.void.
        held2 = client.post(
            f"{SALES_URL}/hold",
            sale_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="hold-2",
        )
        cancelled = client.post(
            f"{SALES_URL}/{held2.json()['data']['id']}/cancel", {}, **host(), format="json"
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["data"]["status"] == "CANCELLED"

    def test_complete_completed_is_409(self, tenant: Any, user: Any) -> None:
        invoice = SalesInvoiceFactory(tenant=tenant, status="COMPLETED")
        grant(tenant, user, "sale.create")
        response = auth_client(user).post(
            f"{SALES_URL}/{invoice.pk}/complete", {}, **host(), format="json"
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "INVOICE_NOT_EDITABLE"


class TestQrTender:
    """QR is a cash-equivalent digital tender: counts toward paid, due zero."""

    def test_qr_sale_completes_paid_in_full(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.create")
        response = auth_client(user).post(
            SALES_URL,
            sale_payload(shop, payments=[{"method": "QR", "amount": "2000.00"}]),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-qr",
        )
        assert response.status_code == 201
        data = response.json()["data"]
        assert data["status"] == "COMPLETED"
        assert data["paid_amount"] == "2000.00"
        assert data["due_amount"] == "0.00"
        assert data["tenders"] == [{"method": "QR", "amount": "2000.00"}]

    def test_qr_split_with_cash(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.create")
        response = auth_client(user).post(
            SALES_URL,
            sale_payload(
                shop,
                payments=[
                    {"method": "QR", "amount": "1500.00"},
                    {"method": "CASH", "amount": "500.00"},
                ],
            ),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-qr-split",
        )
        assert response.status_code == 201
        assert response.json()["data"]["due_amount"] == "0.00"
