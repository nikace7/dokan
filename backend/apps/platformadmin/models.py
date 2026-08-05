"""Platform users — super admin / support / billing staff.

Separate table and token audience from the tenant ``user`` table: a super
admin NEVER gets a row in a tenant's user table (docs/SYSTEM_DESIGN.md §2.4,
ADR 0001). Not wired to Django auth — the admin portal (separate auth realm,
IP allowlist, mandatory 2FA) lands later; this is the model only.
"""

import uuid

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
