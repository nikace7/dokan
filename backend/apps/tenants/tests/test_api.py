"""API tests for tenant-scoped branch metadata."""

from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Permission
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

BRANCHES_URL = "/api/v1/branches"


def host(slug: str) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture
def tenant() -> Any:
    return TenantFactory()


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


class TestBranchList:
    def test_unauthenticated_is_401(self, tenant: Any) -> None:
        assert APIClient().get(BRANCHES_URL, **host(tenant.slug)).status_code == 401

    def test_missing_catalog_view_is_403(self, tenant: Any) -> None:
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "sale.create")
        assert (
            auth_client(user, tenant.slug).get(BRANCHES_URL, **host(tenant.slug)).status_code == 403
        )

    def test_lists_active_branches_with_default_first(self, tenant: Any) -> None:
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "catalog.view")
        BranchFactory(tenant=tenant, code="SECOND", name="Second", is_default=False)
        BranchFactory(tenant=tenant, code="MAIN", name="Main", is_default=True)
        BranchFactory(tenant=tenant, code="CLOSED", name="Closed", is_active=False)

        response = auth_client(user, tenant.slug).get(
            BRANCHES_URL, {"is_active": "true"}, **host(tenant.slug)
        )

        assert response.status_code == 200
        rows = response.json()["data"]
        assert [row["code"] for row in rows] == ["MAIN", "SECOND"]
        assert response.json()["meta"]["count"] == 2

    def test_does_not_return_another_tenants_branches(self, tenant: Any) -> None:
        user = UserFactory(tenant=tenant)
        grant(tenant, user, "catalog.view")
        BranchFactory(tenant=tenant, code="OWN", name="Own")
        other = TenantFactory(slug="othershop")
        BranchFactory(tenant=other, code="OTHER", name="Other")

        response = auth_client(user, tenant.slug).get(BRANCHES_URL, **host(tenant.slug))

        assert response.status_code == 200
        assert [row["code"] for row in response.json()["data"]] == ["OWN"]
