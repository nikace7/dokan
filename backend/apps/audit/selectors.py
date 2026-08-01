"""Read-side queries for the audit log; explicit user arg as always."""

from datetime import date
from typing import TYPE_CHECKING
from uuid import UUID

from django.db.models import QuerySet

from apps.audit.models import AuditLog

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def list_audit_log(
    tenant: "Tenant",
    user: "User",
    *,
    action: str = "",
    target_type: str = "",
    target_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> QuerySet[AuditLog]:
    """The tenant's own log (RLS scopes it; owners read it with
    settings.manage — enforced at the view)."""
    qs = AuditLog.objects.filter(tenant=tenant).select_related("actor")
    if action:
        qs = qs.filter(action=action)
    if target_type:
        qs = qs.filter(target_type=target_type)
    if target_id:
        qs = qs.filter(target_id=target_id)
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    return qs.order_by("-created_at")
