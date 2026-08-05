"""The audit log — append-only accountability (invariant 7).

Written ONLY by explicit ``audit(...)`` calls inside services — never by
signals (signals fire on migrations, fixtures, and shell commands and
produce garbage trails, design §8.6). The migration REVOKEs UPDATE and
DELETE from the app role: wrong entries are reversed by counter-entries,
never edited or removed.

``impersonated_by`` attributes support-session writes to the acting platform
user while retaining the target tenant user as ``actor`` (design §2.6).
"""

import uuid
from typing import ClassVar

from django.db import models

from core.models import TenantScopedModel


class AuditLog(TenantScopedModel):
    """One audited mutation: who did what, to which entity, with diffs."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # NULL for system actions (Celery jobs, later) — wired mutations always
    # have an actor.
    actor = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    action = models.TextField()  # e.g. "price.set", "stock.adjust", "sale.cancel_held"
    target_type = models.TextField()  # e.g. "item_price", "stock_level", "sales_invoice"
    target_id = models.UUIDField()
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    impersonated_by = models.ForeignKey(
        "platformadmin.PlatformUser",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
    )
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "audit_log"
        indexes: ClassVar = [
            models.Index(
                fields=["tenant", "target_type", "target_id", "-created_at"],
                name="audit_tenant_target_idx",
            ),
            models.Index(fields=["tenant", "-created_at"], name="audit_tenant_time_idx"),
            models.Index(fields=["tenant", "action"], name="audit_tenant_action_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.action} on {self.target_type}/{self.target_id}"
