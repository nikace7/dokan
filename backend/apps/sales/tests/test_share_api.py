"""API tests for the shareable online bill.

POST /sales/<id>/share (sale.view, tenant-scoped, idempotent, COMPLETED
only, audited) and GET /sales/shared/<token> (public, throttled, receipt
payload with no cost fields and no staff PII).
"""

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.audit.models import AuditLog
from apps.sales.models import SalesInvoice
from tests.factories import (
    DEFAULT_PASSWORD,
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
def invoice(tenant: Any) -> Any:
    bill = SalesInvoiceFactory(
        tenant=tenant,
        status=SalesInvoice.Status.COMPLETED,
        invoice_no=7,
        tenders=[{"method": "CASH", "amount": "1000.00"}],
    )
    SalesInvoiceItemFactory(tenant=tenant, invoice=bill, cost_at_sale="600.00")
    return bill


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


def share(client: APIClient, invoice: Any, slug: str = SLUG) -> Any:
    return client.post(f"{SALES_URL}/{invoice.pk}/share", {}, **host(slug), format="json")


class TestShareEndpoint:
    def test_unauthenticated_is_401(self, tenant: Any, invoice: Any) -> None:
        assert share(APIClient(), invoice).status_code == 401

    def test_missing_sale_view_is_403(self, tenant: Any, user: Any, invoice: Any) -> None:
        grant(tenant, user, "sale.create")  # some other permission
        assert share(auth_client(user), invoice).status_code == 403

    def test_share_returns_token_and_path(self, tenant: Any, user: Any, invoice: Any) -> None:
        grant(tenant, user, "sale.view")
        response = share(auth_client(user), invoice)
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["share_url_path"] == f"/bill/{data['share_token']}"
        invoice.refresh_from_db()
        assert str(invoice.share_token) == data["share_token"]

    def test_share_is_idempotent(self, tenant: Any, user: Any, invoice: Any) -> None:
        grant(tenant, user, "sale.view")
        client = auth_client(user)
        first = share(client, invoice).json()["data"]
        second = share(client, invoice).json()["data"]
        assert first["share_token"] == second["share_token"]
        # The audit event fires once — when the token is created.
        assert (
            AuditLog.objects.filter(
                tenant=tenant, action="sale.share", target_id=invoice.pk
            ).count()
            == 1
        )

    def test_held_invoice_is_409(self, tenant: Any, user: Any) -> None:
        held = SalesInvoiceFactory(tenant=tenant, status=SalesInvoice.Status.HELD)
        grant(tenant, user, "sale.view")
        response = share(auth_client(user), held)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "INVOICE_NOT_SHAREABLE"

    def test_other_tenants_invoice_is_404(self, tenant: Any, user: Any) -> None:
        other = TenantFactory(slug="other-shop")
        foreign = SalesInvoiceFactory(tenant=other, status=SalesInvoice.Status.COMPLETED)
        grant(tenant, user, "sale.view")
        assert share(auth_client(user), foreign).status_code == 404


class TestSharedBillEndpoint:
    def _shared_url(self, tenant: Any, invoice: Any, user: Any) -> str:
        grant(tenant, user, "sale.view")
        token = share(auth_client(user), invoice).json()["data"]["share_token"]
        return f"{SALES_URL}/shared/{token}"

    def test_public_payload_without_auth(self, tenant: Any, user: Any, invoice: Any) -> None:
        url = self._shared_url(tenant, invoice, user)
        response = APIClient().get(url, **host())  # no credentials
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["id"] == str(invoice.pk)
        assert data["invoice_no"] == 7
        assert data["tenant_name"] == tenant.name
        assert data["tenders"] == [{"method": "CASH", "amount": "1000.00"}]
        assert len(data["items"]) == 1
        assert data["items"][0]["item_name"] == invoice.items.first().variant.item.name

    def test_payload_has_no_cost_or_staff_pii(self, tenant: Any, user: Any, invoice: Any) -> None:
        url = self._shared_url(tenant, invoice, user)
        data = APIClient().get(url, **host()).json()["data"]
        assert "cost_at_sale" not in data["items"][0]
        assert not any("cost" in key for key in data["items"][0])
        assert not any("cost" in key for key in data)
        for staff_field in ("created_by", "created_by_name", "device_id", "idempotency_key"):
            assert staff_field not in data

    def test_unknown_token_is_404(self, tenant: Any) -> None:
        import uuid

        response = APIClient().get(f"{SALES_URL}/shared/{uuid.uuid4()}", **host())
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "BILL_NOT_FOUND"

    def test_token_from_another_tenant_does_not_leak(
        self, tenant: Any, user: Any, invoice: Any
    ) -> None:
        """A token minted by tenant A opened on tenant B's host is a 404."""
        url = self._shared_url(tenant, invoice, user)
        other = TenantFactory(slug="other-shop")
        response = APIClient().get(url, **host(other.slug))
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "BILL_NOT_FOUND"

    def test_invoice_without_token_is_not_public(self, tenant: Any, user: Any) -> None:
        """Unshared invoices stay private: no token exists to look up."""
        bill = SalesInvoiceFactory(tenant=tenant, status=SalesInvoice.Status.COMPLETED)
        assert bill.share_token is None
        response = APIClient().get(f"{SALES_URL}/shared/{bill.pk}", **host())
        assert response.status_code == 404
