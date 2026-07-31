"""API tests for purchase invoice endpoints."""

from decimal import Decimal
from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.inventory.services import post_opening_stock
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    ItemFactory,
    ItemVariantFactory,
    RoleFactory,
    RolePermissionFactory,
    SupplierFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
INVOICES_URL = "/api/v1/purchasing/invoices"


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
    supplier = SupplierFactory(tenant=tenant)
    variant = ItemVariantFactory(tenant=tenant, item=ItemFactory(tenant=tenant))
    return {"branch": branch, "supplier": supplier, "variant": variant}


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


def invoice_payload(shop: dict, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "branch": str(shop["branch"].pk),
        "supplier": str(shop["supplier"].pk),
        "bill_date_ad": "2026-01-15",
        "lines": [{"variant": str(shop["variant"].pk), "qty": "2", "unit_cost": "100.00"}],
    }
    payload.update(overrides)
    return payload


class TestAuthAndPermissions:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(INVOICES_URL, **host()).status_code == 401

    def test_read_requires_stock_view(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "sale.view")
        assert auth_client(user).get(INVOICES_URL, **host()).status_code == 403

    def test_write_requires_stock_purchase(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "stock.view")
        response = auth_client(user).post(
            INVOICES_URL, invoice_payload(shop), **host(), format="json"
        )
        assert response.status_code == 403


class TestInvoiceFlow:
    def test_create_patch_confirm_cancel(self, tenant: Any, user: Any, shop: dict) -> None:
        post_opening_stock(
            tenant,
            branch=shop["branch"],
            variant=shop["variant"],
            qty=Decimal("5"),
            unit_cost=Decimal("90.00"),
            created_by=user,
        )
        grant(tenant, user, "stock.view", "stock.purchase")
        client = auth_client(user)

        created = client.post(INVOICES_URL, invoice_payload(shop), **host(), format="json")
        assert created.status_code == 201
        data = created.json()["data"]
        assert data["status"] == "DRAFT"
        assert data["invoice_no"] is None
        assert data["total"] == "200.00"
        assert len(data["items"]) == 1

        patched = client.patch(
            f"{INVOICES_URL}/{data['id']}",
            {"lines": [{"variant": str(shop["variant"].pk), "qty": "3", "unit_cost": "95.00"}]},
            **host(),
            format="json",
        )
        assert patched.json()["data"]["total"] == "285.00"

        confirmed = client.post(f"{INVOICES_URL}/{data['id']}/confirm", {}, **host(), format="json")
        assert confirmed.status_code == 200
        assert confirmed.json()["data"]["status"] == "CONFIRMED"
        assert confirmed.json()["data"]["invoice_no"] == 1

        # Second draft can be cancelled (DRAFT only).
        draft2 = client.post(INVOICES_URL, invoice_payload(shop), **host(), format="json")
        cancelled = client.post(
            f"{INVOICES_URL}/{draft2.json()['data']['id']}/cancel", {}, **host(), format="json"
        )
        assert cancelled.json()["data"]["status"] == "CANCELLED"

    def test_confirm_twice_is_409(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "stock.purchase")
        client = auth_client(user)
        created = client.post(INVOICES_URL, invoice_payload(shop), **host(), format="json")
        invoice_id = created.json()["data"]["id"]
        client.post(f"{INVOICES_URL}/{invoice_id}/confirm", {}, **host(), format="json")
        response = client.post(f"{INVOICES_URL}/{invoice_id}/confirm", {}, **host(), format="json")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "INVOICE_NOT_EDITABLE"

    def test_patch_confirmed_is_409(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "stock.purchase")
        client = auth_client(user)
        created = client.post(INVOICES_URL, invoice_payload(shop), **host(), format="json")
        invoice_id = created.json()["data"]["id"]
        client.post(f"{INVOICES_URL}/{invoice_id}/confirm", {}, **host(), format="json")
        response = client.patch(
            f"{INVOICES_URL}/{invoice_id}", {"note": "too late"}, **host(), format="json"
        )
        assert response.status_code == 409

    def test_validation_errors(self, tenant: Any, user: Any, shop: dict) -> None:
        import uuid

        grant(tenant, user, "stock.purchase")
        client = auth_client(user)

        unknown_variant = client.post(
            INVOICES_URL,
            invoice_payload(
                shop, lines=[{"variant": str(uuid.uuid4()), "qty": "1", "unit_cost": "10.00"}]
            ),
            **host(),
            format="json",
        )
        assert unknown_variant.status_code == 404

        zero_qty = client.post(
            INVOICES_URL,
            invoice_payload(
                shop, lines=[{"variant": str(shop["variant"].pk), "qty": "0", "unit_cost": "10.00"}]
            ),
            **host(),
            format="json",
        )
        assert zero_qty.status_code == 400
        assert zero_qty.json()["error"]["code"] == "QTY_INVALID"

    def test_list_filters(self, tenant: Any, user: Any, shop: dict) -> None:
        grant(tenant, user, "stock.view", "stock.purchase")
        client = auth_client(user)
        client.post(INVOICES_URL, invoice_payload(shop), **host(), format="json")
        other_supplier = SupplierFactory(tenant=tenant)
        client.post(
            INVOICES_URL,
            invoice_payload(shop, supplier=str(other_supplier.pk)),
            **host(),
            format="json",
        )

        all_invoices = client.get(INVOICES_URL, **host())
        assert all_invoices.json()["meta"]["count"] == 2

        by_supplier = client.get(INVOICES_URL, {"supplier": str(other_supplier.pk)}, **host())
        assert by_supplier.json()["meta"]["count"] == 1

        by_status = client.get(INVOICES_URL, {"status": "DRAFT"}, **host())
        assert by_status.json()["meta"]["count"] == 2

        by_date = client.get(
            INVOICES_URL, {"date_from": "2026-01-01", "date_to": "2026-01-31"}, **host()
        )
        assert by_date.json()["meta"]["count"] == 2

    def test_bad_date_filter_is_400(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "stock.view")
        response = auth_client(user).get(INVOICES_URL, {"date_from": "junk"}, **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "DATE_INVALID"
