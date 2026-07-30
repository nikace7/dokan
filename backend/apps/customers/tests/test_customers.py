"""Tests for customers — model rules and CRUD API."""

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from apps.customers import services
from apps.customers.models import Customer
from core.responses import ServiceError
from tests.factories import (
    DEFAULT_PASSWORD,
    CustomerFactory,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"
LIST_URL = "/api/v1/customers"


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


class TestModelRules:
    def test_phone_unique_per_tenant_when_present(self, tenant: Any) -> None:
        CustomerFactory(tenant=tenant, phone="9800000001")
        with pytest.raises(ServiceError) as exc:
            services.create_customer(tenant, name="Dup", phone="9800000001")
        assert exc.value.code == "ALREADY_EXISTS"

    def test_null_phone_customers_allowed(self, tenant: Any) -> None:
        CustomerFactory(tenant=tenant, phone=None)
        CustomerFactory(tenant=tenant, phone=None)  # second walk-in — must not raise

    def test_same_phone_other_tenant_allowed(self, tenant: Any) -> None:
        CustomerFactory(phone="9800000009")
        CustomerFactory(tenant=tenant, phone="9800000009")

    def test_str(self, tenant: Any) -> None:
        customer = CustomerFactory(tenant=tenant, name="Sita", phone=None)
        assert str(customer) == "Sita (no phone)"


class TestApi:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(LIST_URL, **host()).status_code == 401

    def test_missing_permission_is_403(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "sale.create")
        assert auth_client(user).get(LIST_URL, **host()).status_code == 403

    def test_crud_flow_and_search(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "customer.view", "customer.manage")
        client = auth_client(user)

        created = client.post(
            LIST_URL,
            {"name": "Sita Rai", "phone": "9812345678", "credit_limit": "50000.00"},
            **host(),
        )
        assert created.status_code == 201
        customer_id = created.json()["data"]["id"]
        # Omitted is_active must stay True (DRF boolean coercion trap).
        assert created.json()["data"]["is_active"] is True

        detail = client.get(f"{LIST_URL}/{customer_id}", **host())
        assert detail.json()["data"]["name"] == "Sita Rai"

        searched = client.get(LIST_URL, {"search": "9812"}, **host())
        assert searched.json()["meta"]["count"] == 1

        patched = client.patch(
            f"{LIST_URL}/{customer_id}", {"address": "Pokhara"}, **host(), format="json"
        )
        assert patched.json()["data"]["address"] == "Pokhara"

        deactivated = client.delete(f"{LIST_URL}/{customer_id}", **host())
        assert deactivated.json()["data"]["is_active"] is False
        assert Customer.objects.filter(pk=customer_id).exists()

    def test_update_duplicate_phone_friendly_error(self, tenant: Any, user: Any) -> None:
        grant(tenant, user, "customer.view", "customer.manage")
        client = auth_client(user)
        CustomerFactory(tenant=tenant, phone="9811111111")
        other = CustomerFactory(tenant=tenant, phone="9822222222")
        response = client.patch(
            f"{LIST_URL}/{other.pk}", {"phone": "9811111111"}, **host(), format="json"
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "ALREADY_EXISTS"

    def test_unknown_customer_is_404(self, tenant: Any, user: Any) -> None:
        import uuid

        grant(tenant, user, "customer.view")
        response = auth_client(user).get(f"{LIST_URL}/{uuid.uuid4()}", **host())
        assert response.status_code == 404

    def test_is_active_filter(self, tenant: Any, user: Any) -> None:
        CustomerFactory(tenant=tenant, is_active=True)
        CustomerFactory(tenant=tenant, is_active=False)
        grant(tenant, user, "customer.view")
        response = auth_client(user).get(LIST_URL, {"is_active": "true"}, **host())
        assert response.json()["meta"]["count"] == 1
