"""API tests for auth: token issue/refresh/me, lockout, tenant binding.

Requests go through the full stack (TenantMiddleware → JWT auth), each with
an explicit Host header — the tenant comes only from the subdomain.
"""

from typing import Any

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.services import MAX_FAILED_LOGINS
from tests.factories import (
    DEFAULT_PASSWORD,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

TOKEN_URL = "/api/v1/auth/token"
REFRESH_URL = "/api/v1/auth/token/refresh"
ME_URL = "/api/v1/auth/me"


def host(slug: str) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


def login(client: APIClient, slug: str, phone: str, password: str) -> Any:
    return client.post(TOKEN_URL, {"phone": phone, "password": password}, **host(slug))


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug="shreeganesh")


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant, phone="9811111111")


class TestTokenIssue:
    def test_happy_path_returns_adr0001_claims(self, tenant: Any, user: Any) -> None:
        response = login(APIClient(), "shreeganesh", user.phone, DEFAULT_PASSWORD)
        assert response.status_code == 200
        payload = response.json()["data"]
        assert payload["access"] and payload["refresh"]

        access = AccessToken(payload["access"])
        assert access["sub"] == str(user.pk)
        assert access["tenant"] == str(tenant.pk)
        assert access["aud"] == "tenant"
        assert access["token_use"] == "access"

    def test_success_resets_failed_counter(self, tenant: Any, user: Any) -> None:
        login(APIClient(), "shreeganesh", user.phone, "wrong")
        user.refresh_from_db()
        assert user.failed_login_count == 1

        login(APIClient(), "shreeganesh", user.phone, DEFAULT_PASSWORD)
        user.refresh_from_db()
        assert user.failed_login_count == 0
        assert user.last_login is not None

    def test_wrong_password_increments_counter(self, tenant: Any, user: Any) -> None:
        response = login(APIClient(), "shreeganesh", user.phone, "wrong")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"
        user.refresh_from_db()
        assert user.failed_login_count == 1

    def test_unknown_phone_same_error_as_wrong_password(self, tenant: Any) -> None:
        """The response must not reveal which accounts exist."""
        response = login(APIClient(), "shreeganesh", "9899999999", "wrong")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"

    def test_lockout_after_max_failures(self, tenant: Any, user: Any) -> None:
        client = APIClient()
        for _ in range(MAX_FAILED_LOGINS):
            assert login(client, "shreeganesh", user.phone, "wrong").status_code == 401

        user.refresh_from_db()
        assert user.locked_until is not None

        # Even the correct password is refused while locked.
        response = login(client, "shreeganesh", user.phone, DEFAULT_PASSWORD)
        assert response.status_code == 423
        assert response.json()["error"]["code"] == "ACCOUNT_LOCKED"

    def test_inactive_user_cannot_login(self, tenant: Any, user: Any) -> None:
        user.is_active = False
        user.save()
        response = login(APIClient(), "shreeganesh", user.phone, DEFAULT_PASSWORD)
        assert response.status_code == 401


class TestRefresh:
    def test_refresh_rotates_and_preserves_claims(self, tenant: Any, user: Any) -> None:
        tokens = login(APIClient(), "shreeganesh", user.phone, DEFAULT_PASSWORD).json()["data"]
        response = APIClient().post(
            REFRESH_URL, {"refresh": tokens["refresh"]}, **host("shreeganesh")
        )
        assert response.status_code == 200
        rotated = response.json()["data"]
        assert rotated["access"] != tokens["access"]

        access = AccessToken(rotated["access"])
        assert access["tenant"] == str(tenant.pk)
        assert access["aud"] == "tenant"

    def test_garbage_refresh_rejected(self, tenant: Any) -> None:
        response = APIClient().post(REFRESH_URL, {"refresh": "garbage"}, **host("shreeganesh"))
        assert response.status_code == 401


class TestMe:
    def _auth_client(self, tenant: Any, user: Any, slug: str = "shreeganesh") -> APIClient:
        tokens = login(APIClient(), slug, user.phone, DEFAULT_PASSWORD).json()["data"]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        return client

    def test_me_returns_user_and_permissions(self, tenant: Any, user: Any) -> None:
        role = RoleFactory(tenant=tenant, code="CASHIER")
        RolePermissionFactory(tenant=tenant, role=role)
        UserRoleFactory(tenant=tenant, user=user, role=role)

        response = self._auth_client(tenant, user).get(ME_URL, **host("shreeganesh"))
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["phone"] == user.phone
        assert data["full_name"] == user.full_name
        assert data["permissions"] == ["sale.create"]

    def test_me_without_token_is_401(self, tenant: Any) -> None:
        response = APIClient().get(ME_URL, **host("shreeganesh"))
        assert response.status_code == 401

    def test_token_from_another_tenant_is_hard_403(self, tenant: Any, user: Any) -> None:
        """A JWT replayed against another subdomain: 403 + audit hook (ADR 0001)."""
        other = TenantFactory(slug="othershop")
        UserFactory(tenant=other)  # the other shop exists and is active

        client = self._auth_client(tenant, user)  # token issued for shreeganesh
        response = client.get(ME_URL, **host("othershop"))
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "TOKEN_TENANT_MISMATCH"

    def test_platform_audience_token_rejected(self, tenant: Any, user: Any) -> None:
        """aud=platform tokens are mutually rejected from tenant endpoints."""
        token = AccessToken()
        token["aud"] = "platform"
        token["tenant"] = str(tenant.pk)
        token["user_id"] = str(user.pk)

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        response = client.get(ME_URL, **host("shreeganesh"))
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "REALM_MISMATCH"


class TestTenantGating:
    def test_past_due_tenant_gets_402(self, user: Any) -> None:
        tenant = user.tenant
        tenant.status = "PAST_DUE"
        tenant.save()
        response = login(APIClient(), "shreeganesh", user.phone, DEFAULT_PASSWORD)
        assert response.status_code == 402
        assert response.json()["error"]["code"] == "TENANT_INACTIVE"

    def test_suspended_tenant_gets_423(self, user: Any) -> None:
        tenant = user.tenant
        tenant.status = "SUSPENDED"
        tenant.save()
        response = login(APIClient(), "shreeganesh", user.phone, DEFAULT_PASSWORD)
        assert response.status_code == 423

    def test_unknown_tenant_gets_404(self) -> None:
        response = login(APIClient(), "ghostshop", "9800000000", "x")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "TENANT_NOT_FOUND"

    def test_platform_host_passes_through_with_no_tenant(self, user: Any) -> None:
        """www/app/admin hosts: no tenant context; login is refused politely."""
        response = APIClient().post(
            TOKEN_URL,
            {"phone": user.phone, "password": DEFAULT_PASSWORD},
            HTTP_HOST="www.dokan.com.np",
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "TENANT_REQUIRED"
