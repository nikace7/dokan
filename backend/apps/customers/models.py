"""Customers — the party a shop sells to (and extends udharo credit to).

Tenant-scoped, RLS-protected. Phone is optional (walk-in customers) but
unique per tenant when present (docs/DATABASE_SCHEMA.md §8.1).
"""

import uuid

from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q

from core.models import TenantScopedModel

_pan_validator = RegexValidator(
    regex=r"^\d{1,9}$",
    message="PAN must be up to 9 digits, numbers only.",
)


class Customer(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.TextField()
    phone = models.TextField(null=True, blank=True)
    # VAT-registered customers' PAN — printed on VAT bills/registers.
    pan = models.CharField(max_length=9, null=True, blank=True, validators=[_pan_validator])
    address = models.TextField(null=True, blank=True)
    default_rate_type = models.ForeignKey(
        "pricing.RateType",
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
    )
    # NULL = no credit limit (unlimited udharo, still tracked).
    credit_limit = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    loyalty_points = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    birthday_bs = models.CharField(max_length=10, null=True, blank=True)  # '2082-04-12'
    gender = models.TextField(null=True, blank=True)
    note = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "customer"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "phone"],
                condition=Q(phone__isnull=False),
                name="customer_tenant_phone_uniq",
            )
        ]
        indexes = [models.Index(fields=["tenant", "name"], name="customer_tenant_name_idx")]

    def __str__(self) -> str:
        return f"{self.name} ({self.phone or 'no phone'})"
