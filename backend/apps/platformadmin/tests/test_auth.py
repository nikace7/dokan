"""Security boundary and authentication tests for the platform-admin realm."""

import base64
from typing import Any

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.tokens import TenantRefreshToken
from apps.platformadmin.models import PlatformUser
from apps.platformadmin.totp import generate_totp_secret, totp_code, verify_totp
from tests.factories import TenantFactory, UserFactory

pytestmark = pytest.mark.django_db

TOKEN_URL = "/api/v1/admin/auth/token"
REFRESH_URL = "/api/v1/admin/auth/token/refresh"
ME_URL = "/api/v1/admin/auth/me"
TOTP_SECRET = "JBSWY3DPEHPK3PXP"


def admin_host(ip: str = "203.0.113.9") -> dict[str, str]:
    return {"HTTP_HOST": "admin.dokan.com.np", "REMOTE_ADDR": ip}


@pytest.fixture(autouse=True)
def admin_boundary(settings: Any) -> None:
    settings.PLATFORM_ADMIN_ALLOWED_IPS = ["203.0.113.0/24"]
    cache.clear()


@pytest.fixture
def platform_user() -> PlatformUser:
    user = PlatformUser(
        email="owner@dokan.test",
        full_name="Platform Owner",
        role=PlatformUser.Role.SUPER_ADMIN,
        totp_secret=TOTP_SECRET,
    )
    user.set_password("correct horse battery staple")
    user.save()
    return user


def login(
    user: PlatformUser,
    *,
    password: str = "correct horse battery staple",
    otp: str | None = None,
) -> Any:
    return APIClient().post(
        TOKEN_URL,
        {
            "email": user.email,
            "password": password,
            "otp": otp or totp_code(TOTP_SECRET),
        },
        **admin_host(),
    )


class TestTotp:
    def test_generated_secret_is_valid_base32(self) -> None:
        secret = generate_totp_secret()
        assert len(secret) == 32
        assert totp_code(secret).isdigit()

    def test_rfc6238_sha1_vector(self) -> None:
        secret = base64.b32encode(b"12345678901234567890").decode("ascii")
        assert totp_code(secret, at=59) == "287082"
        assert verify_totp(secret, "287082", at=59)

    @pytest.mark.parametrize("code", ["", "12345", "1234567", "abcdef"])
    def test_rejects_malformed_codes(self, code: str) -> None:
        assert not verify_totp(TOTP_SECRET, code)


class TestAdminBoundary:
    def test_rejects_non_admin_host(self, platform_user: PlatformUser) -> None:
        response = APIClient().post(
            TOKEN_URL,
            {"email": platform_user.email, "password": "x", "otp": "000000"},
            HTTP_HOST="www.dokan.com.np",
            REMOTE_ADDR="203.0.113.9",
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "PLATFORM_HOST_REQUIRED"

    def test_rejects_ip_outside_allowlist(self, platform_user: PlatformUser) -> None:
        response = APIClient().post(
            TOKEN_URL,
            {"email": platform_user.email, "password": "x", "otp": "000000"},
            **admin_host("198.51.100.7"),
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "PLATFORM_IP_FORBIDDEN"

    def test_uses_proxy_visible_rightmost_forwarded_ip(self, platform_user: PlatformUser) -> None:
        response = APIClient().post(
            TOKEN_URL,
            {"email": platform_user.email, "password": "wrong", "otp": "000000"},
            HTTP_HOST="admin.dokan.com.np",
            REMOTE_ADDR="10.0.0.4",
            HTTP_X_FORWARDED_FOR="198.51.100.1, 203.0.113.9",
        )
        assert response.status_code == 401


class TestPlatformProvisioning:
    def test_command_prompts_for_password_and_emits_totp_uri(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        answers = iter(["a secure platform password", "a secure platform password"])
        monkeypatch.setattr(
            "apps.platformadmin.management.commands.create_platform_user.getpass",
            lambda prompt: next(answers),
        )
        call_command(
            "create_platform_user",
            email="ADMIN@DOKAN.TEST",
            full_name="Admin User",
            role=PlatformUser.Role.SUPER_ADMIN,
        )
        user = PlatformUser.objects.get(email="admin@dokan.test")
        assert user.check_password("a secure platform password")
        assert user.totp_secret
        output = capsys.readouterr().out
        assert "otpauth://totp/Dokan%3Aadmin%40dokan.test" in output
        assert user.totp_secret in output

    def test_command_rejects_short_password(self, monkeypatch: pytest.MonkeyPatch) -> None:
        answers = iter(["short", "short"])
        monkeypatch.setattr(
            "apps.platformadmin.management.commands.create_platform_user.getpass",
            lambda prompt: next(answers),
        )
        with pytest.raises(CommandError, match="at least 12"):
            call_command(
                "create_platform_user",
                email="admin@dokan.test",
                full_name="Admin User",
            )


class TestPlatformLogin:
    def test_password_and_totp_issue_platform_claims(self, platform_user: PlatformUser) -> None:
        response = login(platform_user)
        assert response.status_code == 200
        payload = response.json()["data"]

        token = AccessToken(payload["access"])
        assert token["sub"] == str(platform_user.pk)
        assert token["aud"] == "platform"
        assert token["token_use"] == "access"
        assert "tenant" not in token
        platform_user.refresh_from_db()
        assert platform_user.last_login_at is not None

    def test_invalid_password_and_otp_are_indistinguishable(
        self, platform_user: PlatformUser
    ) -> None:
        wrong_password = login(platform_user, password="wrong")
        current = totp_code(TOTP_SECRET)
        wrong_otp = login(platform_user, otp="000000" if current != "000000" else "000001")
        assert wrong_password.status_code == wrong_otp.status_code == 401
        assert wrong_password.json()["error"] == wrong_otp.json()["error"]
        assert wrong_password.json()["error"]["code"] == "INVALID_CREDENTIALS"

    def test_valid_password_requires_configured_totp(self, platform_user: PlatformUser) -> None:
        platform_user.totp_secret = None
        platform_user.save(update_fields=["totp_secret"])
        response = login(platform_user)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "TWO_FACTOR_NOT_CONFIGURED"

    def test_inactive_user_is_rejected(self, platform_user: PlatformUser) -> None:
        platform_user.is_active = False
        platform_user.save(update_fields=["is_active"])
        assert login(platform_user).status_code == 401

    def test_login_is_rate_limited(self, platform_user: PlatformUser) -> None:
        responses = [
            APIClient().post(
                TOKEN_URL,
                {"email": platform_user.email, "password": "wrong", "otp": "000000"},
                HTTP_HOST="admin.dokan.com.np",
                REMOTE_ADDR="10.0.0.4",
                HTTP_X_FORWARDED_FOR=f"198.51.100.{index}, 203.0.113.9",
            )
            for index in range(21)
        ]
        assert responses[-1].status_code == 429


class TestPlatformSession:
    def test_me_returns_safe_platform_identity(self, platform_user: PlatformUser) -> None:
        tokens = login(platform_user).json()["data"]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        response = client.get(ME_URL, **admin_host())
        assert response.status_code == 200
        assert response.json()["data"] == {
            "id": str(platform_user.pk),
            "email": platform_user.email,
            "full_name": platform_user.full_name,
            "role": platform_user.role,
        }

    def test_refresh_rotates_and_preserves_realm(self, platform_user: PlatformUser) -> None:
        tokens = login(platform_user).json()["data"]
        response = APIClient().post(
            REFRESH_URL,
            {"refresh": tokens["refresh"]},
            **admin_host(),
        )
        assert response.status_code == 200
        rotated = response.json()["data"]
        assert rotated["refresh"] != tokens["refresh"]
        access = AccessToken(rotated["access"])
        assert access["sub"] == str(platform_user.pk)
        assert access["aud"] == "platform"

        replay = APIClient().post(
            REFRESH_URL,
            {"refresh": tokens["refresh"]},
            **admin_host(),
        )
        assert replay.status_code == 401

    def test_inactive_user_invalidates_existing_access(self, platform_user: PlatformUser) -> None:
        access = login(platform_user).json()["data"]["access"]
        platform_user.is_active = False
        platform_user.save(update_fields=["is_active"])
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        assert client.get(ME_URL, **admin_host()).status_code == 401

    def test_tenant_refresh_is_rejected(self, platform_user: PlatformUser) -> None:
        tenant = TenantFactory()
        tenant_user = UserFactory(tenant=tenant)
        refresh = TenantRefreshToken.for_user(tenant_user)
        response = APIClient().post(
            REFRESH_URL,
            {"refresh": str(refresh)},
            **admin_host(),
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "REALM_MISMATCH"

    def test_tenant_access_is_rejected(self, platform_user: PlatformUser) -> None:
        tenant = TenantFactory()
        tenant_user = UserFactory(tenant=tenant)
        access = TenantRefreshToken.for_user(tenant_user).access_token
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        response = client.get(ME_URL, **admin_host())
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "REALM_MISMATCH"

    def test_platform_access_is_rejected_by_tenant_realm(self, platform_user: PlatformUser) -> None:
        access = login(platform_user).json()["data"]["access"]
        tenant = TenantFactory(slug="shreeganesh")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        response = client.get(
            "/api/v1/auth/me",
            HTTP_HOST=f"{tenant.slug}.dokan.com.np",
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "REALM_MISMATCH"

    def test_platform_refresh_is_rejected_by_tenant_realm(
        self, platform_user: PlatformUser
    ) -> None:
        refresh = login(platform_user).json()["data"]["refresh"]
        tenant = TenantFactory(slug="shreeganesh")
        response = APIClient().post(
            "/api/v1/auth/token/refresh",
            {"refresh": refresh},
            HTTP_HOST=f"{tenant.slug}.dokan.com.np",
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "REALM_MISMATCH"
