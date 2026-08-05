"""Request-context propagation for explicit service-layer audit writes."""

import uuid

import pytest
from django.conf import settings
from django.http import HttpResponse
from django.test import RequestFactory

from apps.audit.models import AuditLog
from apps.audit.services import audit
from apps.platformadmin.models import PlatformUser
from core.middleware.audit import AuditContextMiddleware, get_audit_request
from tests.factories import TenantFactory, UserFactory

pytestmark = pytest.mark.django_db


def test_middleware_is_registered_inside_tenant_scope() -> None:
    tenant_index = settings.MIDDLEWARE.index("core.middleware.tenant.TenantMiddleware")
    audit_index = settings.MIDDLEWARE.index("core.middleware.audit.AuditContextMiddleware")
    assert audit_index > tenant_index


def test_audit_uses_current_request_context() -> None:
    tenant = TenantFactory()
    user = UserFactory(tenant=tenant)
    captured: AuditLog | None = None

    def response(request: object) -> HttpResponse:
        nonlocal captured
        captured = audit(
            tenant,
            actor=user,
            action="test.context",
            target_type="test",
            target_id=uuid.uuid4(),
        )
        return HttpResponse()

    request = RequestFactory().get(
        "/",
        REMOTE_ADDR="203.0.113.7",
        HTTP_USER_AGENT="Dokan POS/1.0",
    )
    AuditContextMiddleware(response)(request)

    assert captured is not None
    assert captured.ip == "203.0.113.7"
    assert captured.user_agent == "Dokan POS/1.0"
    assert get_audit_request() is None


def test_audit_stamps_impersonator_from_signed_token_claim() -> None:
    tenant = TenantFactory()
    user = UserFactory(tenant=tenant)
    platform_user = PlatformUser.objects.create(
        email="support@dokan.test",
        password_hash="unused",
        full_name="Support Agent",
        role=PlatformUser.Role.SUPPORT,
    )
    captured: AuditLog | None = None

    def response(request: object) -> HttpResponse:
        nonlocal captured
        captured = audit(
            tenant,
            actor=user,
            action="test.impersonated",
            target_type="test",
            target_id=uuid.uuid4(),
        )
        return HttpResponse()

    request = RequestFactory().post("/")
    request.auth = {"act": str(platform_user.pk)}
    AuditContextMiddleware(response)(request)

    assert captured is not None
    assert captured.impersonated_by == platform_user


def test_context_is_reset_when_the_view_raises() -> None:
    def response(request: object) -> HttpResponse:
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        AuditContextMiddleware(response)(RequestFactory().get("/"))

    assert get_audit_request() is None
