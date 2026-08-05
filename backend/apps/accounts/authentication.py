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
from typing import TYPE_CHECKING, Any, cast

from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.accounts.tokens import AUDIENCE_TENANT
from core.middleware.tenant import get_request_tenant

if TYPE_CHECKING:
    from django.http import HttpRequest
    from rest_framework.request import Request

logger = logging.getLogger(__name__)


def record_token_tenant_mismatch(request: "HttpRequest", token: Any) -> None:
    """Security audit hook for a cross-tenant token replay.

    Today: structured application-log event (no PII, no token material —
    AGENTS.md logging rules). When apps.audit lands, this must also write an
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
        return self.get_user(token), token
