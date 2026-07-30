"""Pricing models — rate types, effective-dated prices, change log.

All three tables are tenant-scoped and RLS-protected (migration adds the
policies via core/db/rls.py). Every composite index leads with tenant_id.

Rules honoured here (docs/SYSTEM_DESIGN.md §4):
- Rate types are soft-deleted only (``is_active = false``); historical
  invoices will reference them.
- ``ItemPrice`` rows are effective-dated; resolution picks the most recent
  ``effective_from`` that is active on the date (§4.2).
- ``PriceChangeLog`` is append-only in spirit — no update/delete code path
  exists. The DB-level REVOKE lands with the audit app (same treatment as
  stock_movement got).
"""

import uuid
from typing import ClassVar

from django.db import models
from django.db.models import Q

from core.models import TenantScopedModel


class RateType(TenantScopedModel):
    """A dynamic selling rate (Thok/wholesale, Khudra/retail, Member, …)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.TextField()
    name = models.TextField()
    name_np = models.TextField(null=True, blank=True)
    is_default = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)
    default_margin_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    # NULL = anyone who can bill; otherwise only users holding this codename.
    required_permission = models.ForeignKey(
        "accounts.Permission",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        db_column="required_permission",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "rate_type"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="rate_type_tenant_code_uniq"),
            # Exactly one default rate type per tenant.
            models.UniqueConstraint(
                fields=["tenant"],
                condition=Q(is_default=True),
                name="rate_type_one_default_per_tenant",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


class ItemPrice(TenantScopedModel):
    """Price per rate type at exactly one scope; resolution is first-hit-wins."""

    class Scope(models.TextChoices):
        VARIANT = "VARIANT"
        ITEM = "ITEM"
        CATEGORY = "CATEGORY"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rate_type = models.ForeignKey(RateType, on_delete=models.CASCADE, related_name="prices")
    scope = models.TextField(choices=Scope.choices)
    variant = models.ForeignKey(
        "catalog.ItemVariant", on_delete=models.CASCADE, related_name="+", null=True, blank=True
    )
    item = models.ForeignKey(
        "catalog.Item", on_delete=models.CASCADE, related_name="+", null=True, blank=True
    )
    category = models.ForeignKey(
        "catalog.Category", on_delete=models.CASCADE, related_name="+", null=True, blank=True
    )
    price = models.DecimalField(max_digits=14, decimal_places=2)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)  # NULL = open-ended
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, related_name="+", null=True, blank=True
    )

    class Meta:
        db_table = "item_price"
        constraints = [
            # Exactly the FK matching `scope` is set (docs/DATABASE_SCHEMA.md §5.2).
            models.CheckConstraint(
                condition=(
                    Q(
                        scope="VARIANT",
                        variant__isnull=False,
                        item__isnull=True,
                        category__isnull=True,
                    )
                    | Q(
                        scope="ITEM",
                        item__isnull=False,
                        variant__isnull=True,
                        category__isnull=True,
                    )
                    | Q(
                        scope="CATEGORY",
                        category__isnull=False,
                        variant__isnull=True,
                        item__isnull=True,
                    )
                ),
                name="item_price_scope_fk_check",
            )
        ]
        indexes: ClassVar = [
            models.Index(
                fields=[
                    "tenant",
                    "rate_type",
                    "scope",
                    "variant",
                    "item",
                    "category",
                    "effective_from",
                ],
                name="item_price_resolution_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.scope} price {self.price} ({self.rate_type.code})"


class PriceChangeLog(TenantScopedModel):
    """Append-only record of price changes (DB-level REVOKE lands with audit)."""

    class TargetType(models.TextChoices):
        VARIANT = "VARIANT"
        ITEM = "ITEM"
        CATEGORY = "CATEGORY"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    target_type = models.TextField(choices=TargetType.choices)
    target_id = models.UUIDField()
    rate_type = models.ForeignKey(
        RateType, on_delete=models.SET_NULL, related_name="+", null=True, blank=True
    )
    old_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    new_price = models.DecimalField(max_digits=14, decimal_places=2)
    changed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, related_name="+", null=True, blank=True
    )
    reason = models.TextField(null=True, blank=True)  # required for min-price overrides

    class Meta:
        db_table = "price_change_log"
        indexes: ClassVar = [
            models.Index(
                fields=["tenant", "target_type", "target_id", "-created_at"],
                name="price_change_target_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.target_type} {self.target_id}: {self.old_price} → {self.new_price}"
