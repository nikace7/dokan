"""Platform users — super admin / support / billing staff.

Separate table and token audience from the tenant ``user`` table: a super
admin NEVER gets a row in a tenant's user table (docs/SYSTEM_DESIGN.md §2.4,
ADR 0001). It uses its own admin-host auth realm, IP allowlist, mandatory 2FA,
and role-gated control-plane API.
"""

import uuid
from typing import ClassVar

from django.contrib.auth.hashers import check_password, make_password
from django.db import models


class PlatformUser(models.Model):
    """A platform-side actor (platform scope, no RLS, admin. host only)."""

    class Role(models.TextChoices):
        SUPER_ADMIN = "SUPER_ADMIN"
        SUPPORT = "SUPPORT"
        BILLING = "BILLING"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.TextField(unique=True)
    password_hash = models.TextField()
    full_name = models.TextField()
    role = models.TextField(choices=Role.choices)
    totp_secret = models.TextField(null=True, blank=True)  # mandatory 2FA at the portal
    is_active = models.BooleanField(default=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "platform_user"

    def __str__(self) -> str:
        return f"{self.full_name} <{self.email}> ({self.role})"

    def set_password(self, raw_password: str) -> None:
        """Hash and store a password using Django's hashers."""
        self.password_hash = make_password(raw_password)

    def check_password(self, raw_password: str) -> bool:
        """Verify a password against the stored hash."""
        return check_password(raw_password, self.password_hash)

    @property
    def is_authenticated(self) -> bool:
        """DRF compatibility without joining the tenant auth model."""
        return True


class PlatformAuditLog(models.Model):
    """Append-only audit entry for control-plane mutations."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(PlatformUser, on_delete=models.PROTECT, related_name="audit_entries")
    action = models.TextField()
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.PROTECT,
        related_name="platform_audit_entries",
        null=True,
        blank=True,
    )
    payload = models.JSONField(default=dict)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "platform_audit_log"
        ordering: ClassVar = ["-created_at"]
        indexes: ClassVar = [
            models.Index(fields=["tenant", "-created_at"], name="platform_audit_tenant_idx"),
            models.Index(fields=["actor", "-created_at"], name="platform_audit_actor_idx"),
            models.Index(fields=["action", "-created_at"], name="platform_audit_action_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.action} by {self.actor_id}"
