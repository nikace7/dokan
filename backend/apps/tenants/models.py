"""Tenant, plan, subscription models — plus the tenant-scoped Branch.

Platform-scope tables (``plan``, ``tenant``, ``tenant_subscription``,
``tenant_feature_override``, ``tenant_usage_snapshot``) have NO ``tenant_id``
and NO RLS — they are reachable only from the super-admin service
(docs/MULTI_TENANCY.md §5). ``branch`` is tenant-scoped and gets the full
RLS treatment in the migration via ``core/db/rls.py``.
"""

import uuid
from typing import Any, ClassVar

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q

from apps.tenants.constants import (
    RESERVED_SLUGS,
    SLUG_MAX_LENGTH,
    SLUG_MIN_LENGTH,
    TenantStatus,
)
from core.models import TenantScopedModel

_slug_format = RegexValidator(
    regex=rf"^[a-z0-9-]{{{SLUG_MIN_LENGTH},{SLUG_MAX_LENGTH}}}$",
    message="Slug must be 3–30 characters of lowercase letters, digits, and hyphens.",
)


def validate_slug_not_reserved(slug: str) -> None:
    """Reject reserved platform slugs (docs/MULTI_TENANCY.md §7)."""
    if slug in RESERVED_SLUGS:
        msg = f"'{slug}' is a reserved subdomain."
        raise ValidationError(msg, code="reserved_slug")


class Plan(models.Model):
    """Subscription plan definition (platform scope)."""

    class BillingCycle(models.TextChoices):
        MONTHLY = "monthly"
        YEARLY = "yearly"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.TextField(unique=True)
    name = models.TextField()
    price_npr = models.DecimalField(max_digits=14, decimal_places=2)
    billing_cycle = models.TextField(choices=BillingCycle.choices)
    limits = models.JSONField(default=dict)
    features = models.JSONField(default=dict)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)

    class Meta:
        db_table = "plan"
        ordering: ClassVar = ["sort_order", "code"]

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


class Tenant(models.Model):
    """The shop. Resolved by slug in TenantMiddleware before RLS context exists."""

    class CalendarPref(models.TextChoices):
        BS = "BS"
        AD = "AD"
        BOTH = "BOTH"

    class Locale(models.TextChoices):
        NP = "np"
        EN = "en"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.TextField(
        unique=True,
        validators=[_slug_format, validate_slug_not_reserved],
        help_text="3–30 chars [a-z0-9-], immutable after creation.",
    )
    name = models.TextField()
    name_np = models.TextField(null=True, blank=True)
    legal_name = models.TextField(null=True, blank=True)
    pan_vat_no = models.TextField(null=True, blank=True)
    vat_registered = models.BooleanField(default=False)
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="tenants")
    status = models.TextField(choices=TenantStatus.CHOICES, default=TenantStatus.TRIAL)
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    timezone = models.TextField(default="Asia/Kathmandu")
    calendar_pref = models.TextField(choices=CalendarPref.choices, default=CalendarPref.BS)
    locale = models.TextField(choices=Locale.choices, default=Locale.NP)
    onboarded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)  # soft delete only

    class Meta:
        db_table = "tenant"
        indexes = [models.Index(fields=["status"], name="tenant_status_idx")]

    def __str__(self) -> str:
        return f"{self.name} ({self.slug})"

    def save(self, *args: Any, **kwargs: Any) -> None:
        # Slugs are immutable: changing one breaks bookmarks, cached QR codes,
        # and printed receipts (docs/MULTI_TENANCY.md §7).
        if self.pk is not None and not self._state.adding:
            original = Tenant.objects.filter(pk=self.pk).values_list("slug", flat=True).first()
            if original is not None and original != self.slug:
                msg = "Tenant slug is immutable after creation."
                raise ValidationError(msg, code="immutable_slug")
        super().save(*args, **kwargs)


class TenantSubscription(models.Model):
    """Billing period per tenant (platform scope)."""

    class Status(models.TextChoices):
        PENDING = "PENDING"
        PAID = "PAID"
        FAILED = "FAILED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="subscriptions")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    period_start = models.DateField()
    period_end = models.DateField()
    amount_npr = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.TextField(choices=Status.choices, default=Status.PENDING)
    payment_ref = models.TextField(null=True, blank=True)
    invoice_url = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "tenant_subscription"
        indexes = [models.Index(fields=["tenant", "-period_start"], name="subscription_tenant_idx")]


class TenantFeatureOverride(models.Model):
    """Per-tenant override of a plan limit/feature (platform scope)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="feature_overrides")
    key = models.TextField(help_text="Dotted key into plan limits/features, e.g. limits.max_users.")
    value = models.JSONField()
    expires_at = models.DateTimeField(null=True, blank=True)  # NULL = permanent
    note = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "tenant_feature_override"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "key"], name="tenant_feature_override_uniq")
        ]


class TenantUsageSnapshot(models.Model):
    """Nightly usage rollup for the super-admin dashboard and billing."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="usage_snapshots")
    date = models.DateField()
    users = models.IntegerField()
    items = models.IntegerField()
    invoices_mtd = models.IntegerField()
    storage_mb = models.IntegerField()
    sms_used = models.IntegerField()

    class Meta:
        db_table = "tenant_usage_snapshot"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "date"], name="tenant_usage_snapshot_uniq")
        ]


class Branch(TenantScopedModel):
    """Physical outlet — tenant-scoped, RLS-protected (migration adds policy)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.TextField()
    name = models.TextField()
    name_np = models.TextField(null=True, blank=True)
    address = models.TextField(null=True, blank=True)
    phone = models.TextField(null=True, blank=True)
    invoice_prefix = models.TextField(default="INV")
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "branch"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="branch_tenant_code_uniq"),
            # Exactly one default branch per tenant.
            models.UniqueConstraint(
                fields=["tenant"],
                condition=Q(is_default=True),
                name="branch_one_default_per_tenant",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"
