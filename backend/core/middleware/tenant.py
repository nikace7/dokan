"""Tenant resolution middleware — the front door of every request.

Contract (docs/SYSTEM_DESIGN.md §2.2, docs/MULTI_TENANCY.md §4):

1. The tenant is derived ONLY from the subdomain of the Host header —
   never from a header, body, query param, or JWT claim.
2. Lookup is cached 5 minutes (apps.tenants.selectors; graceful Postgres
   fallback when Redis is unavailable). Writes must invalidate via
   ``apps.tenants.selectors.invalidate_tenant_cache``.
3. Non-active tenants are rejected before any business code runs:
   402 for billing states, 423 for suspended (404 for cancelled/unknown).
4. The request runs inside one DB transaction (opened here) with
   ``SET LOCAL app.tenant_id`` applied, so every RLS policy sees the tenant
   and PgBouncer transaction pooling stays safe.

Platform hosts (``www``, ``app``, ``api``, ``admin``, …) get ``tenant=None``
and no transaction override; RLS then fails closed (``current_setting``
returns NULL and matches nothing).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Final

from django.db import connection, transaction
from django.http import JsonResponse
from django.utils import timezone

from apps.tenants.constants import RESERVED_SLUGS, TenantStatus
from apps.tenants.selectors import get_tenant_by_slug
from core.db.rls import set_local_tenant

if TYPE_CHECKING:
    from collections.abc import Callable

    from django.http import HttpRequest, HttpResponse

_TENANT_ATTR: Final = "tenant"

#: HTTP status per rejected tenant status (docs/MULTI_TENANCY.md §4).
_REJECTED_STATUS_CODES: Final = {
    TenantStatus.PAST_DUE: 402,
    TenantStatus.SUSPENDED: 423,
    TenantStatus.CANCELLED: 404,
}


def extract_subdomain(host: str, root_domain: str) -> str | None:
    """Return the tenant slug from a Host value, or None for platform hosts.

    Returns None for the bare root domain and for anything that is not a
    single-label subdomain of it (nested subdomains are not supported).
    """
    hostname = host.split(":", 1)[0].lower().rstrip(".")
    root = root_domain.lower()
    if hostname == root or not hostname.endswith(f".{root}"):
        return None
    prefix = hostname[: -len(f".{root}")]
    return prefix if "." not in prefix else None


def get_request_tenant(request: HttpRequest) -> Any | None:
    """Typed accessor for the tenant attached by TenantMiddleware."""
    return getattr(request, _TENANT_ATTR, None)


def require_request_tenant(request: HttpRequest) -> Any:
    """Return the request tenant or raise 403 TENANT_REQUIRED.

    Tenant-API endpoints must only run on a shop subdomain; on platform
    hosts there is deliberately no tenant context to work with.
    """
    from rest_framework.exceptions import PermissionDenied

    tenant = get_request_tenant(request)
    if tenant is None:
        raise PermissionDenied(
            detail="This endpoint is only available on a shop subdomain.",
            code="TENANT_REQUIRED",
        )
    return tenant


def _error_response(status: int, code: str, message: str) -> JsonResponse:
    """Render the API error envelope (docs/SYSTEM_DESIGN.md §8.4)."""
    return JsonResponse(
        {"data": None, "error": {"code": code, "message": message}},
        status=status,
    )


class TenantMiddleware:
    """Resolve tenant from subdomain and scope the request transaction."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        from django.conf import settings  # deferred: settings not ready at import

        slug = extract_subdomain(request.get_host(), str(settings.ROOT_DOMAIN))
        if slug is None or slug in RESERVED_SLUGS:
            setattr(request, _TENANT_ATTR, None)
            return self.get_response(request)

        tenant = get_tenant_by_slug(slug)
        if tenant is None:
            return _error_response(
                404, "TENANT_NOT_FOUND", "We could not find this shop. Check the address."
            )

        if (
            tenant.status == TenantStatus.TRIAL
            and tenant.trial_ends_at is not None
            and tenant.trial_ends_at <= timezone.now()
        ):
            return _error_response(
                402,
                "TENANT_TRIAL_EXPIRED",
                "This shop's trial has ended. Please choose a plan to continue.",
            )

        if tenant.status not in TenantStatus.ACTIVE_STATUSES:
            http_status = _REJECTED_STATUS_CODES.get(tenant.status, 423)
            return _error_response(
                http_status,
                "TENANT_INACTIVE",
                "This shop's account is not active. Please contact support.",
            )

        setattr(request, _TENANT_ATTR, tenant)
        # One transaction for the whole request: SET LOCAL lives and dies
        # with it, so tenant context can never leak into another request.
        with transaction.atomic():
            set_local_tenant(connection, tenant.pk)
            return self.get_response(request)
