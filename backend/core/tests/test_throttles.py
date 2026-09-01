"""Security-rate-limit tests for tenant APIs."""

from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.auth_views import TenantTokenRefreshView, TokenObtainView
from apps.accounts.models import Permission
from apps.reports.views import _ReportsAPIView
from core.throttles import ReportThrottle, TenantAuthThrottle, TenantUserThrottle
from tests.factories import (
    DEFAULT_PASSWORD,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_throttle_cache() -> None:
    cache.clear()


def _host(slug: str) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np", "REMOTE_ADDR": "203.0.113.9"}


def _grant(tenant: Any, user: Any, code: str) -> None:
    role = RoleFactory(tenant=tenant)
    RolePermissionFactory(
        tenant=tenant,
        role=role,
        permission=Permission.objects.get(code=code),
    )
    UserRoleFactory(tenant=tenant, user=user, role=role)


def _auth_client(tenant: Any, user: Any) -> APIClient:
    response = APIClient().post(
        "/api/v1/auth/token",
        {"phone": user.phone, "password": DEFAULT_PASSWORD},
        **_host(tenant.slug),
    )
    assert response.status_code == 200
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['data']['access']}")
    return client


def test_throttle_classes_and_rates_are_wired(settings: Any) -> None:
    framework = settings.REST_FRAMEWORK
    assert framework["DEFAULT_THROTTLE_CLASSES"] == ("core.throttles.TenantUserThrottle",)
    assert framework["DEFAULT_THROTTLE_RATES"] == {
        "tenant_user": "300/min",
        "tenant_auth": "60/min",
        "report": "20/min",
    }
    assert TokenObtainView.throttle_classes == (TenantAuthThrottle,)
    assert TenantTokenRefreshView.throttle_classes == (TenantAuthThrottle,)
    assert _ReportsAPIView.throttle_classes == (ReportThrottle,)


def test_authenticated_cache_key_contains_tenant_and_user() -> None:
    shared_user_id = uuid4()
    user = SimpleNamespace(pk=shared_user_id, is_authenticated=True)
    first_request = SimpleNamespace(
        tenant=SimpleNamespace(pk=uuid4()),
        user=user,
        META={"REMOTE_ADDR": "203.0.113.9"},
    )
    second_request = SimpleNamespace(
        tenant=SimpleNamespace(pk=uuid4()),
        user=user,
        META={"REMOTE_ADDR": "203.0.113.9"},
    )

    throttle = TenantUserThrottle()
    first_key = throttle.get_cache_key(first_request, object())
    second_key = throttle.get_cache_key(second_request, object())

    assert str(shared_user_id) in first_key
    assert first_key != second_key


def test_auth_cache_key_is_tenant_scoped_and_uses_proxy_visible_ip() -> None:
    tenant_id = uuid4()
    first_request = SimpleNamespace(
        tenant=SimpleNamespace(pk=tenant_id),
        META={
            "REMOTE_ADDR": "10.0.0.4",
            "HTTP_X_FORWARDED_FOR": "198.51.100.1, 203.0.113.9",
        },
    )
    same_client_request = SimpleNamespace(
        tenant=SimpleNamespace(pk=tenant_id),
        META={
            "REMOTE_ADDR": "10.0.0.5",
            "HTTP_X_FORWARDED_FOR": "192.0.2.1, 203.0.113.9",
        },
    )
    other_tenant_request = SimpleNamespace(
        tenant=SimpleNamespace(pk=uuid4()),
        META=first_request.META,
    )

    throttle = TenantAuthThrottle()
    first_key = throttle.get_cache_key(first_request, object())

    assert first_key == throttle.get_cache_key(same_client_request, object())
    assert first_key != throttle.get_cache_key(other_tenant_request, object())


def test_auth_limit_is_enforced_per_tenant_and_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(TenantAuthThrottle, "rate", "2/min", raising=False)
    first = TenantFactory(slug="throttle-one")
    second = TenantFactory(slug="throttle-two")
    client = APIClient()
    payload = {"phone": "9899999999", "password": "wrong"}

    assert client.post("/api/v1/auth/token", payload, **_host(first.slug)).status_code == 401
    assert client.post("/api/v1/auth/token", payload, **_host(first.slug)).status_code == 401
    blocked = client.post("/api/v1/auth/token", payload, **_host(first.slug))

    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "THROTTLED"
    assert client.post("/api/v1/auth/token", payload, **_host(second.slug)).status_code == 401


def test_global_user_limit_is_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(TenantUserThrottle, "rate", "2/min", raising=False)
    tenant = TenantFactory(slug="global-throttle")
    user = UserFactory(tenant=tenant)
    client = _auth_client(tenant, user)

    assert client.get("/api/v1/auth/me", **_host(tenant.slug)).status_code == 200
    assert client.get("/api/v1/auth/me", **_host(tenant.slug)).status_code == 200
    assert client.get("/api/v1/auth/me", **_host(tenant.slug)).status_code == 429


def test_report_limit_is_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ReportThrottle, "rate", "2/min", raising=False)
    tenant = TenantFactory(slug="report-throttle")
    user = UserFactory(tenant=tenant)
    _grant(tenant, user, "report.sales")
    client = _auth_client(tenant, user)
    url = "/api/v1/reports/daily-sales"

    assert client.get(url, **_host(tenant.slug)).status_code == 200
    assert client.get(url, **_host(tenant.slug)).status_code == 200
    assert client.get(url, **_host(tenant.slug)).status_code == 429
