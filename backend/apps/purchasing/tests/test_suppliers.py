"""Tests for suppliers — model rules and CRUD API."""

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.purchasing.models import Supplier
from tests.factories import (
    DEFAULT_PASSWORD,
    RoleFactory,
    RolePermissionFactory,
    SupplierFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
LIST_URL = "/api/v1/purchasing/suppliers"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug=SLUG)


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


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


class TestSupplierApi:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(LIST_URL, **host()).status_code == 401

    def test_read_requires_stock_view(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "sale.view")
        assert auth_client(user).get(LIST_URL, **host()).status_code == 403

    def test_write_requires_stock_purchase(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "stock.view")
        response = auth_client(user).post(LIST_URL, {"name": "Kalimati"}, **host())
        assert response.status_code == 403

    def test_crud_flow_and_search(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "stock.view", "stock.purchase")
        client = auth_client(user)

        created = client.post(
            LIST_URL,
            {"name": "Kalimati Suppliers", "phone": "9851000001", "pan_no": "600123456"},
            **host(),
        )
        assert created.status_code == 201
        supplier_id = created.json()["data"]["id"]
        assert created.json()["data"]["is_active"] is True

        searched = client.get(LIST_URL, {"search": "600123"}, **host())
        assert searched.json()["meta"]["count"] == 1

        patched = client.patch(
            f"{LIST_URL}/{supplier_id}", {"credit_days": 30}, **host(), format="json"
        )
        assert patched.json()["data"]["credit_days"] == 30

        deactivated = client.delete(f"{LIST_URL}/{supplier_id}", **host())
        assert deactivated.json()["data"]["is_active"] is False
        assert Supplier.objects.filter(pk=supplier_id).exists()

    def test_unknown_supplier_is_404(self, tenant: Any, user: Any) -> None:
        import uuid

        grant(tenant, user, "stock.view")
        response = auth_client(user).get(f"{LIST_URL}/{uuid.uuid4()}", **host())
        assert response.status_code == 404

    def test_str(self, tenant: Any) -> None:
        assert str(SupplierFactory(tenant=tenant, name="Kalimati")) == "Kalimati"
