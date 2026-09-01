"""Tenant-aware DRF throttles for the shared-schema API."""

from typing import Any

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from core.middleware.platform_admin import get_client_ip
from core.middleware.tenant import get_request_tenant


def _tenant_ident(request: Any) -> str:
    tenant = get_request_tenant(request)
    return str(tenant.pk) if tenant is not None else "platform"


class TenantUserThrottle(UserRateThrottle):
    """Global tenant API limit keyed by tenant plus user (or client IP)."""

    scope = "tenant_user"

    def get_cache_key(self, request: Any, view: object) -> str:
        del view
        user = getattr(request, "user", None)
        subject = (
            f"user:{user.pk}"
            if user is not None and user.is_authenticated
            else f"ip:{get_client_ip(request)}"
        )
        return self.cache_format % {
            "scope": self.scope,
            "ident": f"tenant:{_tenant_ident(request)}:{subject}",
        }


class TenantAuthThrottle(AnonRateThrottle):
    """Tenant login/refresh limit keyed by tenant plus proxy-visible IP."""

    scope = "tenant_auth"

    def get_cache_key(self, request: Any, view: object) -> str:
        del view
        return self.cache_format % {
            "scope": self.scope,
            "ident": f"tenant:{_tenant_ident(request)}:ip:{get_client_ip(request)}",
        }


class ReportThrottle(TenantUserThrottle):
    """Tighter per-tenant-user limit for report generation endpoints."""

    scope = "report"
