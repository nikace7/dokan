"""Security contract for time-boxed platform support access."""

from datetime import timedelta
from typing import Any
from uuid import uuid4

import pytest
from django.core.cache import cache
from django.db import connection, transaction
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import UntypedToken

from apps.accounts.models import Permission, Role, RolePermission, UserRole
from apps.audit.models import AuditLog
from apps.notifications.models import SmsLog
from apps.platformadmin.models import ImpersonationSession, PlatformAuditLog, PlatformUser
from apps.platformadmin.tokens import issue_platform_tokens
from core.db.rls import set_local_tenant
from tests.factories import PlanFactory, TenantFactory, UserFactory

pytestmark = pytest.mark.django_db


def admin_host() -> dict[str, str]:
    return {
        "HTTP_HOST": "admin.dokan.com.np",
        "REMOTE_ADDR": "10.0.0.4",
        "HTTP_X_FORWARDED_FOR": "198.51.100.9, 203.0.113.8",
        "HTTP_USER_AGENT": "Dokan support console",
    }


def tenant_host(slug: str) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


@pytest.fixture(autouse=True)
def boundaries(settings: Any) -> None:
    settings.PLATFORM_ADMIN_ALLOWED_IPS = ["203.0.113.0/24"]
    cache.clear()


def platform_client(
    role: str = PlatformUser.Role.SUPER_ADMIN,
) -> tuple[APIClient, PlatformUser]:
    actor = PlatformUser.objects.create(
        email=f"{role.lower()}-{uuid4()}@dokan.test",
        full_name="Ram Support",
        role=role,
        password_hash="unused",
        totp_secret="unused",
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_platform_tokens(actor)['access']}")
    return client, actor


def tenant_user(*, owner: bool = False, permission: str | None = None) -> tuple[Any, Any]:
    plan = PlanFactory(features={"sms": False}, limits={})
    tenant = TenantFactory(plan=plan)
    with transaction.atomic():
        set_local_tenant(connection, tenant.pk)
        user = UserFactory(tenant=tenant, phone="9800000042", full_name="Shop Owner")
        if owner or permission:
            role = Role.objects.create(
                tenant=tenant,
                code="OWNER",
                name="Owner",
                is_system=True,
            )
            UserRole.objects.create(tenant=tenant, user=user, role=role)
            if permission:
                RolePermission.objects.create(
                    tenant=tenant,
                    role=role,
                    permission=Permission.objects.get(code=permission),
                )
    return tenant, user


def start_payload(user: Any, **overrides: Any) -> dict[str, Any]:
    payload = {
        "target_user": str(user.pk),
        "reason": "Investigating the reported billing discrepancy.",
        "scope": "READ_ONLY",
        "duration_minutes": 15,
    }
    payload.update(overrides)
    return payload


def start_session(
    client: APIClient,
    tenant: Any,
    user: Any,
    **overrides: Any,
) -> Any:
    return client.post(
        f"/api/v1/admin/tenants/{tenant.pk}/impersonate",
        start_payload(user, **overrides),
        format="json",
        **admin_host(),
    )


class TestStartSupportAccess:
    @pytest.mark.parametrize(
        ("role", "scope", "expected"),
        [
            (PlatformUser.Role.SUPPORT, "READ_ONLY", 201),
            (PlatformUser.Role.SUPPORT, "READ_WRITE", 403),
            (PlatformUser.Role.BILLING, "READ_ONLY", 403),
        ],
    )
    def test_platform_roles_limit_scope(self, role: str, scope: str, expected: int) -> None:
        tenant, user = tenant_user(owner=True)
        client, _ = platform_client(role)
        response = start_session(client, tenant, user, scope=scope)
        assert response.status_code == expected

    @pytest.mark.parametrize(
        ("overrides", "code"),
        [
            ({"reason": "too short"}, "IMPERSONATION_REASON_INVALID"),
            ({"duration_minutes": 61}, "IMPERSONATION_DURATION_INVALID"),
            ({"scope": "ROOT"}, "IMPERSONATION_SCOPE_INVALID"),
        ],
    )
    def test_reason_and_duration_are_bounded(self, overrides: dict[str, Any], code: str) -> None:
        tenant, user = tenant_user(owner=True)
        client, _ = platform_client()
        response = start_session(client, tenant, user, **overrides)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == code

    def test_target_user_must_belong_to_the_requested_tenant(self) -> None:
        tenant, _ = tenant_user(owner=True)
        _, other_user = tenant_user(owner=True)
        client, _ = platform_client()
        response = start_session(client, tenant, other_user)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "IMPERSONATION_TARGET_NOT_FOUND"

    def test_start_issues_bounded_token_and_audits_without_exposing_secrets(self) -> None:
        tenant, user = tenant_user(owner=True)
        client, actor = platform_client(PlatformUser.Role.SUPPORT)
        before = timezone.now()
        response = start_session(client, tenant, user)
        assert response.status_code == 201

        data = response.json()["data"]
        session = ImpersonationSession.objects.get(pk=data["session"]["id"])
        token = UntypedToken(data["access"])
        assert token["sub"] == token["user_id"] == str(user.pk)
        assert token["tenant"] == str(tenant.pk)
        assert token["act"] == str(actor.pk)
        assert token["scope"] == "read_only"
        assert token["jti"] == str(session.pk)
        assert before + timedelta(minutes=14, seconds=50) <= session.expires_at
        assert session.expires_at <= before + timedelta(minutes=15, seconds=10)
        assert session.ip == "203.0.113.8"
        assert session.user_agent == "Dokan support console"

        audit = PlatformAuditLog.objects.get(action="impersonation.start")
        assert audit.tenant == tenant
        assert "access" not in str(audit.payload)
        assert SmsLog.objects.get(tenant=tenant).template == "support_access"


class TestImpersonatedRequests:
    def test_read_only_token_can_read_but_cannot_write(self) -> None:
        tenant, user = tenant_user(owner=True)
        admin, _ = platform_client(PlatformUser.Role.SUPPORT)
        access = start_session(admin, tenant, user).json()["data"]["access"]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

        assert client.get("/api/v1/auth/me", **tenant_host(tenant.slug)).status_code == 200
        denied = client.post(
            "/api/v1/customers",
            {"name": "Blocked write"},
            format="json",
            **tenant_host(tenant.slug),
        )
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "IMPERSONATION_READ_ONLY"

    def test_read_write_stamps_audit_but_still_blocks_user_management(self) -> None:
        tenant, user = tenant_user(permission="settings.manage")
        admin, actor = platform_client()
        access = start_session(admin, tenant, user, scope="READ_WRITE").json()["data"]["access"]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

        created = client.patch(
            "/api/v1/settings",
            {"name": "Updated during support"},
            format="json",
            **tenant_host(tenant.slug),
        )
        assert created.status_code == 200
        assert AuditLog.objects.get(action="tenant.settings.update").impersonated_by_id == actor.pk

        blocked = client.post(
            "/api/v1/users",
            {},
            format="json",
            **tenant_host(tenant.slug),
        )
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "IMPERSONATION_ACTION_BLOCKED"

    def test_ended_session_is_rejected_immediately(self) -> None:
        tenant, user = tenant_user(owner=True)
        admin, _ = platform_client()
        started = start_session(admin, tenant, user).json()["data"]
        ended = admin.post(
            f"/api/v1/admin/impersonations/{started['session']['id']}/end",
            format="json",
            **admin_host(),
        )
        assert ended.status_code == 200

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {started['access']}")
        denied = client.get("/api/v1/auth/me", **tenant_host(tenant.slug))
        assert denied.status_code == 401
        assert denied.json()["error"]["code"] == "IMPERSONATION_ENDED"

    def test_read_only_support_actor_can_end_the_current_session(self) -> None:
        tenant, user = tenant_user(owner=True)
        admin, actor = platform_client(PlatformUser.Role.SUPPORT)
        started = start_session(admin, tenant, user).json()["data"]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {started['access']}")

        current = client.get("/api/v1/support-access/current", **tenant_host(tenant.slug))
        assert current.status_code == 200
        assert current.json()["data"]["platform_user_name"] == actor.full_name

        ended = client.post(
            f"/api/v1/support-access/{started['session']['id']}/end",
            format="json",
            **tenant_host(tenant.slug),
        )
        assert ended.status_code == 200
        session = ImpersonationSession.objects.get(pk=started["session"]["id"])
        assert session.ended_by == actor.pk

        denied = client.get("/api/v1/auth/me", **tenant_host(tenant.slug))
        assert denied.status_code == 401


class TestOwnerVisibility:
    def test_non_owner_cannot_read_the_support_access_log(self) -> None:
        tenant, owner = tenant_user(owner=True)
        with transaction.atomic():
            set_local_tenant(connection, tenant.pk)
            staff = UserFactory(tenant=tenant)
        admin, _ = platform_client(PlatformUser.Role.SUPPORT)
        assert start_session(admin, tenant, owner).status_code == 201

        from apps.accounts.tokens import issue_tokens_for_user

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_tokens_for_user(staff)['access']}")
        response = client.get("/api/v1/support-access", **tenant_host(tenant.slug))
        assert response.status_code == 403

    def test_owner_can_list_and_end_support_access(self) -> None:
        tenant, owner = tenant_user(owner=True)
        admin, actor = platform_client(PlatformUser.Role.SUPPORT)
        started = start_session(admin, tenant, owner).json()["data"]
        owner_client = APIClient()
        from apps.accounts.tokens import issue_tokens_for_user

        owner_client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {issue_tokens_for_user(owner)['access']}"
        )
        response = owner_client.get("/api/v1/support-access", **tenant_host(tenant.slug))
        assert response.status_code == 200
        assert response.json()["data"][0]["platform_user_name"] == actor.full_name

        ended = owner_client.post(
            f"/api/v1/support-access/{started['session']['id']}/end",
            format="json",
            **tenant_host(tenant.slug),
        )
        assert ended.status_code == 200
        session = ImpersonationSession.objects.get(pk=started["session"]["id"])
        assert session.ended_at is not None
        assert session.ended_by == owner.pk
        assert PlatformAuditLog.objects.filter(action="impersonation.end", tenant=tenant).exists()
