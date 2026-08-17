"""JWT authentication with tenant binding (ADR 0001).

After SimpleJWT verifies the signature, two pure claim checks run — no DB
calls on the hot path:

1. ``aud`` must be ``tenant`` — platform-realm tokens are mutually rejected
   from tenant endpoints (the admin portal will enforce the mirror image).
2. ``tenant`` must equal the subdomain-derived request tenant. A mismatch is
   a hard 403 plus a security audit event — token theft across tenants must
   be loud, not silent (docs/MULTI_TENANCY.md §6).
"""

import logging
from typing import TYPE_CHECKING, Any, Final, cast

from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.permissions import SAFE_METHODS
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.accounts.tokens import AUDIENCE_TENANT
from core.middleware.tenant import get_request_tenant

if TYPE_CHECKING:
    from django.http import HttpRequest
    from rest_framework.request import Request

logger = logging.getLogger(__name__)

_IMPERSONATION_BLOCKED_PREFIXES: Final = (
    "/api/v1/users",
    "/api/v1/roles",
    "/api/v1/permissions",
    "/api/v1/auth/password",
    "/api/v1/export",
    "/api/v1/admin/",
)


def _is_support_self_end(request: "HttpRequest") -> bool:
    path = request.path_info.rstrip("/")
    return (
        request.method == "POST"
        and path.startswith("/api/v1/support-access/")
        and path.endswith("/end")
    )


def _enforce_impersonation(request: "HttpRequest", token: Any) -> None:
    from apps.platformadmin.impersonation import impersonation_is_active

    if not impersonation_is_active(token):
        raise AuthenticationFailed(
            "This support session has ended or expired.",
            code="IMPERSONATION_ENDED",
        )
    if request.path_info.startswith(_IMPERSONATION_BLOCKED_PREFIXES):
        raise PermissionDenied(
            detail="This action is blocked during support access.",
            code="IMPERSONATION_ACTION_BLOCKED",
        )
    scope = token.get("scope")
    if scope not in {"read_only", "read_write"}:
        raise PermissionDenied(
            detail="This support token has an invalid scope.",
            code="IMPERSONATION_SCOPE_INVALID",
        )
    if (
        scope == "read_only"
        and request.method not in SAFE_METHODS
        and not _is_support_self_end(request)
    ):
        raise PermissionDenied(
            detail="This support session is read-only.",
            code="IMPERSONATION_READ_ONLY",
        )
    if (
        scope == "read_write"
        and request.method not in SAFE_METHODS
        and request.path_info.rstrip("/") != "/api/v1/settings"
        and not _is_support_self_end(request)
    ):
        # ponytail: fail closed until another write service has explicit audit coverage.
        raise PermissionDenied(
            detail="This action is not approved for write support access.",
            code="IMPERSONATION_ACTION_BLOCKED",
        )


def record_token_tenant_mismatch(request: "HttpRequest", token: Any) -> None:
    """Security audit hook for a cross-tenant token replay.

    Today: structured application-log event (no PII, no token material —
    docs/ARCHITECTURE.md §8 logging rules). When apps.audit lands, this must also write an
    ``audit_log`` row — token theft across tenants is an accountability
    event, not just a debug line.
    """
    logger.warning(
        "token tenant mismatch",
        extra={
            "token_tenant": token.get("tenant"),
            "path": request.path,
            "method": request.method,
        },
    )


class TenantJWTAuthentication(JWTAuthentication):
    """SimpleJWT authentication + ADR 0001 claim enforcement."""

    def authenticate(self, request: "HttpRequest") -> tuple[Any, Any] | None:
        drf_request = cast("Request", request)
        header = cast("bytes | None", self.get_header(drf_request))
        if header is None:
            return None
        raw_token = self.get_raw_token(header)
        if raw_token is None:
            return None
        token = self.get_validated_token(raw_token)
        if token.get("aud") != AUDIENCE_TENANT or token.get("token_use") != "access":
            raise PermissionDenied(detail="This token is not valid here.", code="REALM_MISMATCH")

        request_tenant = get_request_tenant(request)
        if request_tenant is None:
            raise PermissionDenied(
                detail="Tenant API is only available on a shop subdomain.",
                code="TENANT_REQUIRED",
            )
        if token.get("tenant") != str(request_tenant.pk):
            record_token_tenant_mismatch(request, token)
            raise PermissionDenied(
                detail="This token belongs to a different shop.",
                code="TOKEN_TENANT_MISMATCH",
            )
        if token.get("act"):
            _enforce_impersonation(request, token)
        return self.get_user(token), token
