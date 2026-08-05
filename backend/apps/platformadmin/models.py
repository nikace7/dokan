"""Platform users — super admin / support / billing staff.

Separate table and token audience from the tenant ``user`` table: a super
admin NEVER gets a row in a tenant's user table (docs/SYSTEM_DESIGN.md §2.4,
ADR 0001). It uses its own admin-host auth realm, IP allowlist, mandatory 2FA,
and role-gated control-plane API.
"""

import uuid
from datetime import timedelta
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


class ImpersonationSession(models.Model):
    """Time-boxed support access without creating a tenant user for platform staff."""

    class Scope(models.TextChoices):
        READ_ONLY = "READ_ONLY", "Read only"
        READ_WRITE = "READ_WRITE", "Read/write"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    platform_user = models.ForeignKey(
        PlatformUser,
        on_delete=models.PROTECT,
        related_name="impersonation_sessions",
    )
    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.PROTECT,
        related_name="impersonation_sessions",
    )
    target_user_id = models.UUIDField()
    reason = models.TextField()
    scope = models.TextField(choices=Scope.choices, default=Scope.READ_ONLY)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    ended_by = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "impersonation_session"
        ordering: ClassVar = ["-started_at"]
        indexes: ClassVar = [
            models.Index(fields=["tenant", "-started_at"], name="impersonation_tenant_idx")
        ]
        constraints: ClassVar = [
            models.CheckConstraint(
                condition=models.Q(scope__in=("READ_ONLY", "READ_WRITE")),
                name="impersonation_scope_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(expires_at__gt=models.F("started_at")),
                name="impersonation_expiry_after_start",
            ),
            models.CheckConstraint(
                condition=models.Q(expires_at__lte=models.F("started_at") + timedelta(minutes=60)),
                name="impersonation_duration_max_60m",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.platform_user_id} as {self.target_user_id}"
