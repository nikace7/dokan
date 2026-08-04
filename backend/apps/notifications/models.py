"""Tenant-scoped SMS delivery log (ADR 0004)."""

import uuid
from typing import ClassVar

from django.db import models

from core.models import TenantScopedModel


class SmsLog(TenantScopedModel):
    """One template-driven SMS and its provider delivery state."""

    class Status(models.TextChoices):
        QUEUED = "QUEUED"
        SENT = "SENT"
        DELIVERED = "DELIVERED"
        FAILED = "FAILED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    to_phone = models.TextField()
    template = models.TextField()
    body = models.TextField()
    provider = models.TextField(null=True, blank=True)
    provider_message_id = models.TextField(null=True, blank=True)
    status = models.TextField(choices=Status.choices, default=Status.QUEUED)
    cost = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)

    class Meta:
        db_table = "sms_log"
        indexes: ClassVar = [
            models.Index(fields=["tenant", "-created_at"], name="sms_tenant_created_idx"),
            models.Index(fields=["tenant", "status"], name="sms_tenant_status_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.template}: {self.status}"
