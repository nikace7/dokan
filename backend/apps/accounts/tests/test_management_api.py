"""Owner-only staff and role administration API tests."""

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission, User
from apps.audit.models import AuditLog
from tests.factories import (
    DEFAULT_PASSWORD,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

USERS_URL = "/api/v1/users"
ROLES_URL = "/api/v1/roles"


def host(slug: str) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


def grant(tenant: Any, user: Any, *codes: str) -> None:
    role = RoleFactory(tenant=tenant)
    for code in codes:
        RolePermissionFactory(
            tenant=tenant, role=role, permission=Permission.objects.get(code=code)
        )
    UserRoleFactory(tenant=tenant, user=user, role=role)


def auth_client(user: Any, slug: str) -> APIClient:
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


@pytest.fixture
def tenant() -> Any:
    return TenantFactory()


class TestStaffManagement:
    def test_requires_authentication_and_permission(self, tenant: Any) -> None:
        assert APIClient().get(USERS_URL, **host(tenant.slug)).status_code == 401
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "settings.manage")
        assert auth_client(user, tenant.slug).get(USERS_URL, **host(tenant.slug)).status_code == 403

    def test_lists_roles_and_staff(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")
        role = RoleFactory(tenant=tenant, code="CASHIER", name="Cashier")
        RolePermissionFactory(
            tenant=tenant,
            role=role,
            permission=Permission.objects.get(code="sale.create"),
        )
        staff = UserFactory(tenant=tenant, full_name="Counter Staff")
        UserRoleFactory(tenant=tenant, user=staff, role=role)

        client = auth_client(owner, tenant.slug)
        roles = client.get(ROLES_URL, **host(tenant.slug))
        users = client.get(USERS_URL, **host(tenant.slug))

        assert roles.status_code == 200
        cashier = next(row for row in roles.json()["data"] if row["code"] == "CASHIER")
        assert cashier["permission_codes"] == ["sale.create"]
        assert users.status_code == 200
        counter = next(row for row in users.json()["data"] if row["full_name"] == "Counter Staff")
        assert counter["roles"][0]["code"] == "CASHIER"

    def test_creates_staff_with_initial_password_and_role(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")
        role = RoleFactory(tenant=tenant, code="CASHIER", name="Cashier")

        response = auth_client(owner, tenant.slug).post(
            USERS_URL,
            {
                "phone": "9800000099",
                "full_name": "New Cashier",
                "email": "cashier@example.com",
                "password": "initial123",
                "role": str(role.pk),
            },
            format="json",
            **host(tenant.slug),
        )

        assert response.status_code == 201
        staff = User.objects.get(tenant=tenant, phone="9800000099")
        assert staff.must_change_password is True
        assert staff.check_password("initial123")
        assert response.json()["data"]["roles"][0]["code"] == "CASHIER"
        assert AuditLog.objects.filter(tenant=tenant, action="user.create").exists()

    def test_assigns_role_and_invalidates_permission_cache(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")
        staff = UserFactory(tenant=tenant)
        role = RoleFactory(tenant=tenant, code="CASHIER", name="Cashier")
        RolePermissionFactory(
            tenant=tenant,
            role=role,
            permission=Permission.objects.get(code="sale.create"),
        )
        assert staff.has_perm("sale.create") is False

        response = auth_client(owner, tenant.slug).post(
            f"{USERS_URL}/{staff.pk}/roles",
            {"role": str(role.pk)},
            format="json",
            **host(tenant.slug),
        )

        assert response.status_code == 201
        assert staff.has_perm("sale.create") is True
        assert AuditLog.objects.filter(tenant=tenant, action="user.role.assign").exists()

    def test_tenant_token_cannot_manage_another_tenant(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")
        other = TenantFactory(slug="othershop")
        UserFactory(tenant=other)

        response = auth_client(owner, tenant.slug).get(USERS_URL, **host(other.slug))

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "TOKEN_TENANT_MISMATCH"
