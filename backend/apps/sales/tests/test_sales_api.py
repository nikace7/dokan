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
from apps.sales.models import SalesInvoice
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    ItemFactory,
    ItemVariantFactory,
    RateTypeFactory,
    RoleFactory,
    RolePermissionFactory,
    SalesInvoiceFactory,
    SalesInvoiceItemFactory,
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


class TestAuthAndPermissions:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(SALES_URL, **host()).status_code == 401

    def test_missing_sale_view_is_403(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "catalog.view")
        assert auth_client(user).get(SALES_URL, **host()).status_code == 403

    def test_write_without_sale_create_is_403(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.view")
        response = auth_client(user).post(
            SALES_URL,
            sale_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-1",
        )
        assert response.status_code == 403

    def test_cancel_without_sale_void_is_403(self, tenant: Any, user: Any) -> None:
        import uuid

        grant(tenant, user, "sale.create")
        response = auth_client(user).post(
            f"{SALES_URL}/{uuid.uuid4()}/cancel", {}, **host(), format="json"
        )
        assert response.status_code == 403


class TestCreateSaleApi:
    def test_sale_requires_open_cash_session(self, tenant: Any, user: Any, shop: dict) -> None:
        payment_session = payment_services.get_open_session(tenant, shop["branch"])
        assert payment_session is not None
        payment_services.close_session(
            tenant,
            session=payment_session,
            counted_cash=Decimal("0.00"),
            closed_by=user,
        )
        grant(tenant, user, "sale.create")

        response = auth_client(user).post(
            SALES_URL,
            sale_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="requires-session",
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "CASH_SESSION_REQUIRED"

    def test_held_bill_can_wait_for_session_before_completion(
        self, tenant: Any, user: Any, shop: dict
    ) -> None:
        payment_session = payment_services.get_open_session(tenant, shop["branch"])
        assert payment_session is not None
        payment_services.close_session(
            tenant,
            session=payment_session,
            counted_cash=Decimal("0.00"),
            closed_by=user,
        )
        grant(tenant, user, "sale.create")
        client = auth_client(user)

        held = client.post(
            f"{SALES_URL}/hold",
            sale_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="held-without-session",
        )
        assert held.status_code == 201

        completed = client.post(
            f"{SALES_URL}/{held.json()['data']['id']}/complete",
            {"payments": [{"method": "CASH", "amount": "2000.00"}]},
            **host(),
            format="json",
        )
        assert completed.status_code == 409
        assert completed.json()["error"]["code"] == "CASH_SESSION_REQUIRED"

    def test_missing_idempotency_key_is_400(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.create")
        response = auth_client(user).post(SALES_URL, sale_payload(shop), **host(), format="json")
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"

    def test_happy_path_201_with_lines(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.create", "pricing.view_cost")
        response = auth_client(user).post(
            SALES_URL,
            sale_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-1",
        )
        assert response.status_code == 201
        data = response.json()["data"]
        assert data["status"] == "COMPLETED"
        assert data["invoice_no"] == 1
        assert data["total"] == "2000.00"
        assert data["due_amount"] == "0.00"
        assert len(data["items"]) == 1
        assert data["items"][0]["cost_at_sale"] == "600.00"  # cost user sees it

    def test_replay_returns_original_with_200(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.create")
        client = auth_client(user)
        first = client.post(
            SALES_URL,
            sale_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-replay",
        )
        payment_session = payment_services.get_open_session(tenant, shop["branch"])
        assert payment_session is not None
        payment_services.close_session(
            tenant,
            session=payment_session,
            counted_cash=Decimal("0.00"),
            closed_by=user,
        )
        second = client.post(
            SALES_URL,
            sale_payload(shop),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-replay",
        )
        assert first.status_code == 201
        assert second.status_code == 200
        assert second.headers.get("X-Idempotent-Replay") == "true"
        assert second.json()["data"]["id"] == first.json()["data"]["id"]
        assert SalesInvoice.objects.filter(tenant=tenant).count() == 1

    def test_unknown_variant_is_404(self, tenant: Any, user: Any, shop: dict) -> None:
        import uuid

        grant(tenant, user, "sale.create")
        response = auth_client(user).post(
            SALES_URL,
            sale_payload(shop, lines=[{"variant": str(uuid.uuid4()), "qty": "1"}]),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-2",
        )
        assert response.status_code == 404

    def test_insufficient_stock_error(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "sale.create")
        response = auth_client(user).post(
            SALES_URL,
            sale_payload(
                shop,
                lines=[{"variant": str(shop["variant"].pk), "qty": "999"}],
                # Paid in full so the credit check doesn't mask the stock error.
                payments=[{"method": "CASH", "amount": "999000.00"}],
            ),
            **host(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="k-3",
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "STOCK_INSUFFICIENT"


class TestCostVisibilityOnLines:
    def test_lines_hide_cost_without_permission(self, tenant: Any, user: Any) -> None:
        invoice = SalesInvoiceFactory(tenant=tenant)
        SalesInvoiceItemFactory(tenant=tenant, invoice=invoice, cost_at_sale="600.00")
        grant(tenant, user, "sale.view")
        response = auth_client(user).get(f"{SALES_URL}/{invoice.pk}", **host())
        assert "cost_at_sale" not in response.json()["data"]["items"][0]

    def test_lines_show_cost_with_permission(self, tenant: Any, user: Any) -> None:
        invoice = SalesInvoiceFactory(tenant=tenant)
        SalesInvoiceItemFactory(tenant=tenant, invoice=invoice, cost_at_sale="600.00")
        grant(tenant, user, "sale.view", "pricing.view_cost")
        response = auth_client(user).get(f"{SALES_URL}/{invoice.pk}", **host())
        assert response.json()["data"]["items"][0]["cost_at_sale"] == "600.00"

    def test_unknown_invoice_is_404(self, tenant: Any, user: Any) -> None:
        import uuid

        grant(tenant, user, "sale.view")
        response = auth_client(user).get(f"{SALES_URL}/{uuid.uuid4()}", **host())
        assert response.status_code == 404


class TestListAndFilters:
    def test_status_and_bs_date_filters(self, tenant: Any, user: Any) -> None:
        from datetime import date

        SalesInvoiceFactory(tenant=tenant, status="COMPLETED", business_date_ad=date(2026, 1, 10))
        SalesInvoiceFactory(tenant=tenant, status="HELD", business_date_ad=date(2026, 1, 11))
        grant(tenant, user, "sale.view")
        client = auth_client(user)

        completed = client.get(SALES_URL, {"status": "COMPLETED"}, **host())
        assert completed.json()["meta"]["count"] == 1

        # AD 2026-01-10/11 = BS 2082-09-26/27 (Poush) — lexical BS filters.
        in_range = client.get(
            SALES_URL, {"date_from_bs": "2082-09-01", "date_to_bs": "2082-09-30"}, **host()
        )
        assert in_range.json()["meta"]["count"] == 2
        from_27th = client.get(SALES_URL, {"date_from_bs": "2082-09-27"}, **host())
        assert from_27th.json()["meta"]["count"] == 1

    def test_bad_date_param_is_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "sale.view")
        response = auth_client(user).get(SALES_URL, {"date_from": "junk"}, **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "DATE_INVALID"


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
