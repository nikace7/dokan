"""Owner-only staff and role administration API tests."""

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission, Role, RolePermission, User, UserRole
from apps.audit.models import AuditLog
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

USERS_URL = "/api/v1/users"
ROLES_URL = "/api/v1/roles"
PERMISSIONS_URL = "/api/v1/permissions"


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

    def test_assigns_role_to_branch_and_rejects_other_tenant_branch(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")
        staff = UserFactory(tenant=tenant)
        role = RoleFactory(tenant=tenant, code="CASHIER", name="Cashier")
        branch = BranchFactory(tenant=tenant, code="MAIN", name="Main outlet")
        other_branch = BranchFactory(tenant=TenantFactory(slug="otherbranch"))
        client = auth_client(owner, tenant.slug)

        assigned = client.post(
            f"{USERS_URL}/{staff.pk}/roles",
            {"role": str(role.pk), "branch": str(branch.pk)},
            format="json",
            **host(tenant.slug),
        )
        rejected = client.post(
            f"{USERS_URL}/{staff.pk}/roles",
            {"role": str(role.pk), "branch": str(other_branch.pk)},
            format="json",
            **host(tenant.slug),
        )

        assert assigned.status_code == 201
        assert assigned.json()["data"]["branch"] == "MAIN"
        assert rejected.status_code == 404
        assert UserRole.objects.filter(user=staff, role=role, branch=branch).exists()

    def test_tenant_token_cannot_manage_another_tenant(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")
        other = TenantFactory(slug="othershop")
        UserFactory(tenant=other)

        response = auth_client(owner, tenant.slug).get(USERS_URL, **host(other.slug))

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "TOKEN_TENANT_MISMATCH"


class TestRoleManagement:
    def test_lists_permission_catalog(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")

        response = auth_client(owner, tenant.slug).get(PERMISSIONS_URL, **host(tenant.slug))

        assert response.status_code == 200
        codes = {row["code"] for row in response.json()["data"]}
        assert {"sale.create", "pricing.view_cost", "user.manage"} <= codes

    def test_creates_custom_role_with_permissions(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")

        response = auth_client(owner, tenant.slug).post(
            ROLES_URL,
            {
                "code": "SUPERVISOR",
                "name": "Supervisor",
                "description": "Floor supervisor",
                "permission_codes": ["sale.create", "report.sales"],
            },
            format="json",
            **host(tenant.slug),
        )

        assert response.status_code == 201
        role = Role.objects.get(tenant=tenant, code="SUPERVISOR")
        assert role.is_system is False
        assert set(
            RolePermission.objects.filter(role=role).values_list("permission_id", flat=True)
        ) == {"sale.create", "report.sales"}
        assert AuditLog.objects.filter(tenant=tenant, action="role.create").exists()

    def test_updates_custom_role_and_invalidates_assigned_user(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")
        staff = UserFactory(tenant=tenant)
        role = RoleFactory(tenant=tenant, code="SUPERVISOR", name="Supervisor")
        RolePermissionFactory(
            tenant=tenant,
            role=role,
            permission=Permission.objects.get(code="sale.create"),
        )
        UserRoleFactory(tenant=tenant, user=staff, role=role)
        assert staff.has_perm("sale.create") is True

        response = auth_client(owner, tenant.slug).patch(
            f"{ROLES_URL}/{role.pk}",
            {"name": "Floor Supervisor", "permission_codes": ["report.sales"]},
            format="json",
            **host(tenant.slug),
        )

        assert response.status_code == 200
        assert role.__class__.objects.get(pk=role.pk).name == "Floor Supervisor"
        assert staff.has_perm("sale.create") is False
        assert staff.has_perm("report.sales") is True
        assert AuditLog.objects.filter(tenant=tenant, action="role.update").exists()

    def test_system_role_is_protected_and_custom_role_can_be_deleted(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")
        system_role = RoleFactory(tenant=tenant, code="OWNER", name="Owner", is_system=True)
        client = auth_client(owner, tenant.slug)

        protected = client.patch(
            f"{ROLES_URL}/{system_role.pk}",
            {"name": "Changed"},
            format="json",
            **host(tenant.slug),
        )

        assert protected.status_code == 409
        custom_role = RoleFactory(tenant=tenant, code="TEMP", name="Temporary")
        deleted = client.delete(f"{ROLES_URL}/{custom_role.pk}", **host(tenant.slug))

        assert deleted.status_code == 200
        assert not Role.objects.filter(pk=custom_role.pk).exists()
        assert AuditLog.objects.filter(tenant=tenant, action="role.delete").exists()

    def test_role_in_use_cannot_be_deleted(self, tenant: Any) -> None:
        owner = UserFactory(tenant=tenant)
        grant(tenant, owner, "user.manage")
        role = RoleFactory(tenant=tenant, code="CASHIER", name="Cashier")
        UserRoleFactory(tenant=tenant, user=UserFactory(tenant=tenant), role=role)

        response = auth_client(owner, tenant.slug).delete(
            f"{ROLES_URL}/{role.pk}", **host(tenant.slug)
        )

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "ROLE_IN_USE"
