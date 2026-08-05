"""Read-side queries for compliance; explicit user arg as always."""

from typing import TYPE_CHECKING
from uuid import UUID

from django.db.models import QuerySet

from apps.compliance.models import CbmsSyncLog

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def get_status_for_invoice(tenant: "Tenant", user: "User", invoice_id: UUID) -> CbmsSyncLog | None:
    """The sync row for one bill (None when never enqueued)."""
    return (
        CbmsSyncLog.objects.filter(tenant=tenant, invoice_id=invoice_id)
        .select_related("invoice")
        .first()
    )


def list_failures(tenant: "Tenant", user: "User") -> QuerySet[CbmsSyncLog]:
    """Failed syncs for the admin-facing retry dashboard."""
    return (
        CbmsSyncLog.objects.filter(tenant=tenant, status=CbmsSyncLog.Status.FAILED)
        .select_related("invoice", "invoice__branch")
        .order_by("-created_at")
    )
