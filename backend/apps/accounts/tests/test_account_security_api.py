"""Security contract for recovery, login OTP, and revocable device sessions."""

import re
from typing import Any
from uuid import UUID

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import AccountOtp, AuthSession
from apps.audit.models import AuditLog
from apps.notifications.models import SmsLog
from tests.factories import DEFAULT_PASSWORD, TenantFactory, UserFactory

pytestmark = pytest.mark.django_db

TOKEN_URL = "/api/v1/auth/token"
REFRESH_URL = "/api/v1/auth/token/refresh"
RESET_REQUEST_URL = "/api/v1/auth/password-reset/request"
RESET_CONFIRM_URL = "/api/v1/auth/password-reset/confirm"


def host(slug: str) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np", "HTTP_USER_AGENT": "pytest-browser/1"}


def login(
    tenant: Any,
    user: Any,
    *,
    client: APIClient | None = None,
    device_id: str = "11111111-1111-4111-8111-111111111111",
    device_name: str = "Front counter",
    password: str = DEFAULT_PASSWORD,
    **extra: Any,
) -> Any:
    return (client or APIClient()).post(
        TOKEN_URL,
        {
            "phone": user.phone,
            "password": password,
            "device_id": device_id,
            "device_name": device_name,
            **extra,
        },
        **host(tenant.slug),
    )


def authed_client(tokens: dict[str, str]) -> APIClient:
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return client


def latest_otp_code(template: str) -> str:
    body = SmsLog.objects.filter(template=template).latest("created_at").body
    match = re.search(r"\b(\d{6})\b", body)
    assert match is not None
    return match.group(1)


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug="secure-shop")


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant, phone="9811111111")


class TestDeviceSessions:
    def test_login_registers_device_and_binds_both_tokens(self, tenant: Any, user: Any) -> None:
        response = login(tenant, user)

        assert response.status_code == 200
        payload = response.json()["data"]
        session = AuthSession.objects.get(user=user)
        assert session.device_id == UUID("11111111-1111-4111-8111-111111111111")
        assert session.device_name == "Front counter"
        assert session.user_agent == "pytest-browser/1"
        assert session.revoked_at is None
        assert AccessToken(payload["access"])["sid"] == str(session.pk)
        assert AccessToken(payload["access"])["tenant"] == str(tenant.pk)

    def test_new_login_on_same_device_revokes_old_access(self, tenant: Any, user: Any) -> None:
        old = login(tenant, user).json()["data"]
        new = login(tenant, user).json()["data"]

        assert new["access"] != old["access"]
        client = authed_client(old)
        denied = client.get("/api/v1/auth/me", **host(tenant.slug))
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "SESSION_REVOKED"

    def test_refresh_rejects_revoked_session(self, tenant: Any, user: Any) -> None:
        tokens = login(tenant, user).json()["data"]
        AuthSession.objects.update(revoked_at=AuthSession.objects.get().created_at)

        response = APIClient().post(
            REFRESH_URL,
            {"refresh": tokens["refresh"]},
            **host(tenant.slug),
        )

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "SESSION_REVOKED"

    def test_refresh_is_bound_to_tenant_host(self, tenant: Any, user: Any) -> None:
        tokens = login(tenant, user).json()["data"]
        other = TenantFactory(slug="other-secure-shop")

        response = APIClient().post(
            REFRESH_URL,
            {"refresh": tokens["refresh"]},
            **host(other.slug),
        )

        assert response.status_code == 403
        assert response.json()["error"]["code"] == "TOKEN_TENANT_MISMATCH"

    def test_list_marks_current_and_can_revoke_another_device(self, tenant: Any, user: Any) -> None:
        current = login(tenant, user).json()["data"]
        other = login(
            tenant,
            user,
            device_id="22222222-2222-4222-8222-222222222222",
            device_name="Owner phone",
        ).json()["data"]
        current_client = authed_client(current)

        listed = current_client.get("/api/v1/auth/sessions", **host(tenant.slug))
        assert listed.status_code == 200
        rows = listed.json()["data"]
        assert {row["device_name"] for row in rows} == {"Front counter", "Owner phone"}
        current_row = next(row for row in rows if row["current"])
        other_row = next(row for row in rows if not row["current"])
        assert current_row["revoked_at"] is None

        revoked = current_client.post(
            f"/api/v1/auth/sessions/{other_row['id']}/revoke",
            **host(tenant.slug),
        )
        assert revoked.status_code == 200
        denied = authed_client(other).get("/api/v1/auth/me", **host(tenant.slug))
        assert denied.status_code == 401
        assert AuditLog.objects.filter(action="auth.session.revoke", actor=user).exists()

    def test_logout_revokes_current_session(self, tenant: Any, user: Any) -> None:
        tokens = login(tenant, user).json()["data"]
        client = authed_client(tokens)

        response = client.post(
            "/api/v1/auth/logout",
            {"refresh": tokens["refresh"]},
            **host(tenant.slug),
        )

        assert response.status_code == 200
        assert AuthSession.objects.get(user=user).revoked_at is not None
        assert client.get("/api/v1/auth/me", **host(tenant.slug)).status_code == 401
        assert AuditLog.objects.filter(action="auth.logout", actor=user).exists()


class TestPasswordRecovery:
    def test_request_is_enumeration_safe_and_stores_only_hashed_code(
        self, tenant: Any, user: Any
    ) -> None:
        known = APIClient().post(RESET_REQUEST_URL, {"phone": user.phone}, **host(tenant.slug))
        unknown = APIClient().post(
            RESET_REQUEST_URL,
            {"phone": "9899999999"},
            **host(tenant.slug),
        )

        assert known.status_code == unknown.status_code == 202
        assert known.json() == unknown.json()
        challenge = AccountOtp.objects.get(user=user, purpose=AccountOtp.Purpose.PASSWORD_RESET)
        code = latest_otp_code("password_reset")
        assert challenge.code_hash != code
        assert code not in challenge.code_hash

    def test_wrong_code_is_bounded_and_locks_challenge(self, tenant: Any, user: Any) -> None:
        APIClient().post(RESET_REQUEST_URL, {"phone": user.phone}, **host(tenant.slug))

        for attempt in range(5):
            response = APIClient().post(
                RESET_CONFIRM_URL,
                {"phone": user.phone, "code": "000000", "new_password": "New-safe-pass-456"},
                **host(tenant.slug),
            )
            expected = "OTP_LOCKED" if attempt == 4 else "OTP_INVALID"
            assert response.json()["error"]["code"] == expected

        challenge = AccountOtp.objects.get(user=user)
        assert challenge.attempts == 5

    def test_success_changes_password_and_revokes_every_session(
        self, tenant: Any, user: Any
    ) -> None:
        login(tenant, user)
        APIClient().post(RESET_REQUEST_URL, {"phone": user.phone}, **host(tenant.slug))
        code = latest_otp_code("password_reset")

        response = APIClient().post(
            RESET_CONFIRM_URL,
            {"phone": user.phone, "code": code, "new_password": "New-safe-pass-456"},
            **host(tenant.slug),
        )

        assert response.status_code == 200
        user.refresh_from_db()
        assert user.check_password("New-safe-pass-456")
        assert user.must_change_password is False
        assert not AuthSession.objects.filter(user=user, revoked_at__isnull=True).exists()
        assert login(tenant, user).status_code == 401
        assert login(tenant, user, password="New-safe-pass-456").status_code == 200
        assert AuditLog.objects.filter(action="auth.password.reset", actor=user).exists()


class TestPasswordChange:
    def test_change_keeps_current_device_and_revokes_others(self, tenant: Any, user: Any) -> None:
        current = login(tenant, user).json()["data"]
        login(
            tenant,
            user,
            device_id="22222222-2222-4222-8222-222222222222",
            device_name="Owner phone",
        )
        current_client = authed_client(current)

        response = current_client.post(
            "/api/v1/auth/password/change",
            {"current_password": DEFAULT_PASSWORD, "new_password": "New-safe-pass-456"},
            **host(tenant.slug),
        )

        assert response.status_code == 200
        active = AuthSession.objects.filter(user=user, revoked_at__isnull=True)
        assert active.count() == 1
        assert str(active.get().pk) == AccessToken(current["access"])["sid"]
        assert current_client.get("/api/v1/auth/me", **host(tenant.slug)).status_code == 200


class TestOptionalLoginOtp:
    def test_user_can_enable_complete_otp_login_and_disable(self, tenant: Any, user: Any) -> None:
        initial = login(tenant, user).json()["data"]
        client = authed_client(initial)
        requested = client.post("/api/v1/auth/login-otp/request", **host(tenant.slug))
        assert requested.status_code == 202
        enable_code = latest_otp_code("login_otp_enable")

        confirmed = client.post(
            "/api/v1/auth/login-otp/confirm",
            {"code": enable_code},
            **host(tenant.slug),
        )
        assert confirmed.status_code == 200
        user.refresh_from_db()
        assert user.login_otp_required is True

        pending = login(
            tenant,
            user,
            device_id="33333333-3333-4333-8333-333333333333",
        )
        assert pending.status_code == 428
        assert pending.json()["error"]["code"] == "OTP_REQUIRED"
        challenge_id = pending.json()["error"]["details"]["challenge_id"]
        login_code = latest_otp_code("login_otp")
        completed = login(
            tenant,
            user,
            device_id="33333333-3333-4333-8333-333333333333",
            challenge_id=challenge_id,
            otp=login_code,
        )
        assert completed.status_code == 200

        completed_client = authed_client(completed.json()["data"])
        disabled = completed_client.delete(
            "/api/v1/auth/login-otp",
            {"current_password": DEFAULT_PASSWORD},
            format="json",
            **host(tenant.slug),
        )
        assert disabled.status_code == 200
        user.refresh_from_db()
        assert user.login_otp_required is False
