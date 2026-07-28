"""Tests for core/middleware/tenant.py — subdomain parsing and gating.

The tenant-lookup and SET LOCAL paths need the tenants.Tenant model and a
live Postgres; they land with the feat(tenants) commit. What is tested here
is everything that does not: host parsing, platform-host passthrough, and
the loud failure when the tenant model does not exist yet.
"""

import pytest
from django.http import HttpRequest, HttpResponse
from django.test import RequestFactory

from apps.tenants.constants import RESERVED_SLUGS
from apps.tenants.selectors import invalidate_tenant_cache
from core.middleware.tenant import (
    TenantMiddleware,
    extract_subdomain,
    get_request_tenant,
)

ROOT = "dokan.com.np"


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("shreeganesh.dokan.com.np", "shreeganesh"),
        ("shreeganesh.dokan.com.np:8000", "shreeganesh"),  # port stripped
        ("ShreeGanesh.DOKAN.com.np", "shreeganesh"),  # case-insensitive
        ("dokan.com.np", None),  # bare root domain
        ("a.b.dokan.com.np", None),  # nested subdomains unsupported
        ("shreeganesh.example.com", None),  # different domain entirely
        ("localhost:8000", None),
    ],
)
def test_extract_subdomain(host: str, expected: str | None) -> None:
    assert extract_subdomain(host, ROOT) == expected


def _make_middleware() -> tuple[TenantMiddleware, list[HttpRequest]]:
    seen: list[HttpRequest] = []

    def get_response(request: HttpRequest) -> HttpResponse:
        seen.append(request)
        return HttpResponse("ok")

    return TenantMiddleware(get_response), seen


def test_platform_host_passes_through_without_tenant() -> None:
    middleware, seen = _make_middleware()
    request = RequestFactory().get("/", HTTP_HOST=f"www.{ROOT}")
    response = middleware(request)
    assert response.status_code == 200
    assert get_request_tenant(seen[0]) is None


def test_reserved_slugs_pass_through() -> None:
    assert {"www", "app", "api", "admin"} <= RESERVED_SLUGS
    middleware, seen = _make_middleware()
    request = RequestFactory().get("/", HTTP_HOST=f"admin.{ROOT}")
    middleware(request)
    assert get_request_tenant(seen[0]) is None


@pytest.mark.django_db
def test_unknown_tenant_slug_gets_404() -> None:
    """A slug with no tenant row is rejected before any business code runs."""
    middleware, _ = _make_middleware()
    request = RequestFactory().get("/", HTTP_HOST="ghostshop.dokan.com.np")
    response = middleware(request)
    assert response.status_code == 404
    assert b"TENANT_NOT_FOUND" in response.content


def test_invalidate_tenant_cache_is_callable() -> None:
    invalidate_tenant_cache("shreeganesh")  # must not raise on a cold cache
