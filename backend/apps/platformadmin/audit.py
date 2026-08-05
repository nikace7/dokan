"""Explicit append-only audit writes for the platform control plane."""

from typing import TYPE_CHECKING, Any

from apps.platformadmin.models import PlatformAuditLog, PlatformUser
from core.middleware.platform_admin import get_client_ip

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.tenants.models import Tenant


def audit_platform(
    *,
    actor: PlatformUser,
    action: str,
    tenant: "Tenant | None" = None,
    payload: dict[str, Any] | None = None,
    request: "HttpRequest | None" = None,
) -> PlatformAuditLog:
    """Write one audit row inside the caller's transaction."""
    ip = get_client_ip(request) or None if request is not None else None
    return PlatformAuditLog.objects.create(
        actor=actor,
        action=action,
        tenant=tenant,
        payload=payload or {},
        ip=ip,
    )
