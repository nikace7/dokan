"""The audit write path — the ONLY way audit rows are created.

Rules (ARCHITECTURE §6 invariant 7, design §8.6):
- Services call ``audit(...)`` explicitly, inside the SAME transaction as
  the mutation it records. Never signals.
- Application logs and audit logs are different things: this module never
  writes to application logging, and application logs never contain these
  payloads (PII/cost rules apply to logs, not to the audit trail — the
  audit trail stores full before/after diffs by design).
"""

from typing import TYPE_CHECKING, Any

from apps.audit.models import AuditLog
from core.middleware.audit import get_audit_request

if TYPE_CHECKING:
    from django.http import HttpRequest

    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def _extract_ip(request: "HttpRequest | None") -> str | None:
    """Client IP from the request, when one is passed.

    Uses the right-most X-Forwarded-For entry when present (the proxy's
    view), else REMOTE_ADDR. No request (Celery, management commands) →
    NULL — no fake addresses.
    """
    if request is None:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.META.get("REMOTE_ADDR") or None


def _extract_user_agent(request: "HttpRequest | None") -> str | None:
    if request is None:
        return None
    return request.META.get("HTTP_USER_AGENT") or None


def _extract_impersonator(request: "HttpRequest | None") -> Any:
    if request is None:
        return None
    auth = getattr(request, "auth", None)
    getter = getattr(auth, "get", None)
    return getter("act") if callable(getter) else None


def audit(
    tenant: "Tenant",
    *,
    actor: "User | None",
    action: str,
    target_type: str,
    target_id: Any,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    request: "HttpRequest | None" = None,
    impersonated_by: Any = None,
) -> AuditLog:
    """Write one audit row. Call inside the mutation's transaction.

    ``target_id`` accepts a model instance (uses its pk) or a uuid/str.
    Request metadata is inherited from the middleware when ``request`` is
    omitted. Outside a request, those fields remain NULL.
    """
    current_request = request or get_audit_request()
    pk = getattr(target_id, "pk", target_id)
    impersonator = impersonated_by or _extract_impersonator(current_request)
    return AuditLog.objects.create(
        tenant=tenant,
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=pk,
        before=before,
        after=after,
        impersonated_by_id=getattr(impersonator, "pk", impersonator),
        ip=_extract_ip(current_request),
        user_agent=_extract_user_agent(current_request),
    )
