"""Compliance models — the durable CBMS sync queue/log.

One row per fiscal document (COMPLETED sale invoice or RETURN credit
note), created at completion time with a full payload snapshot. The row
IS the durable retry queue (design §1172: "CBMS real-time sync with
durable retry queue and a visible sync status per bill").

Mutability (documented): ``payload`` and ``invoice`` are immutable by
service convention — a sync row never changes what it claims to send.
Only the sync-state fields (status/attempts/last_error/synced_at) move,
so the migration REVOKEs DELETE but keeps UPDATE (unlike fully
append-only tables such as stock_movement/audit_log/payment).
"""

import uuid
from typing import ClassVar

from django.db import models

from core.models import TenantScopedModel


class CbmsSyncLog(TenantScopedModel):
    """One fiscal document's CBMS sync state and payload snapshot."""

    class Status(models.TextChoices):
        PENDING = "PENDING"
        SYNCED = "SYNCED"
        FAILED = "FAILED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(
        "sales.SalesInvoice", on_delete=models.PROTECT, related_name="cbms_sync_logs"
    )
    payload = models.JSONField()  # frozen at completion — never rewritten
    status = models.TextField(choices=Status.choices, default=Status.PENDING)
    attempts = models.IntegerField(default=0)
    last_error = models.TextField(null=True, blank=True)
    synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "cbms_sync_log"
        constraints = [
            # One queue row per fiscal document — enqueue is idempotent.
            models.UniqueConstraint(fields=["tenant", "invoice"], name="cbms_sync_invoice_uniq")
        ]
        indexes: ClassVar = [
            models.Index(fields=["tenant", "status"], name="cbms_sync_tenant_status_idx"),
            models.Index(fields=["tenant", "-created_at"], name="cbms_sync_tenant_created_idx"),
        ]

    def __str__(self) -> str:
        return f"CBMS {self.invoice_id}: {self.status} ({self.attempts} attempts)"
