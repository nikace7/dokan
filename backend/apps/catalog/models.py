"""Catalog models — category tree, brand, size chart, item, variant.

All five tables are tenant-scoped and RLS-protected (migration adds the
policies via core/db/rls.py). Every composite index leads with tenant_id.

Invariants honoured here:
- ``avg_cost`` on ItemVariant is written ONLY by the inventory service
  (moving weighted average, later). Catalog endpoints never write it, and
  it is visible only to users with ``pricing.view_cost``.
- Items/variants are deactivated, never hard-deleted — stock and sales
  history will reference them.
"""

import uuid
from typing import ClassVar

from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import Q

from core.models import TenantScopedModel


class SizeChart(TenantScopedModel):
    """An ordered list of sizes, e.g. ['S','M','L','XL'] or ['28','30','32']."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.TextField()
    values = ArrayField(models.TextField(), default=list)  # ORDERED — display order
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "size_chart"

    def __str__(self) -> str:
        return f"{self.name} ({len(self.values)} sizes)"


class Category(TenantScopedModel):
    """Self-referencing category tree. Cycles are rejected in the service layer."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        related_name="children",
        null=True,
        blank=True,
    )
    name = models.TextField()
    name_np = models.TextField(null=True, blank=True)
    size_chart = models.ForeignKey(
        SizeChart,
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
    )
    default_margin_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    min_price_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    max_price_pct = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "category"
        indexes = [models.Index(fields=["tenant", "parent"], name="category_tenant_parent_idx")]

    def __str__(self) -> str:
        return self.name


class Brand(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.TextField()
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "brand"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "name"], name="brand_tenant_name_uniq")
        ]

    def __str__(self) -> str:
        return self.name


class Item(TenantScopedModel):
    """The style. Never stocked or sold directly — variants are."""

    class Gender(models.TextChoices):
        M = "M"
        F = "F"
        U = "U"
        KIDS = "KIDS"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.TextField()
    name = models.TextField()
    name_np = models.TextField(null=True, blank=True)
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name="items", null=True, blank=True
    )
    brand = models.ForeignKey(
        Brand, on_delete=models.SET_NULL, related_name="items", null=True, blank=True
    )
    size_chart = models.ForeignKey(
        SizeChart, on_delete=models.SET_NULL, related_name="items", null=True, blank=True
    )
    gender = models.TextField(choices=Gender.choices, null=True, blank=True)
    season = models.TextField(null=True, blank=True)
    collection_tag = models.TextField(null=True, blank=True)
    hsn_code = models.TextField(null=True, blank=True)
    unit = models.TextField(default="PCS")
    is_vat_applicable = models.BooleanField(default=False)
    images = models.JSONField(null=True, blank=True)
    attributes = models.JSONField(null=True, blank=True)  # fabric, fit, care — escape hatch
    min_selling_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    max_selling_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    reorder_level = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "item"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "code"], name="item_tenant_code_uniq")
        ]
        indexes = [models.Index(fields=["tenant", "category"], name="item_tenant_category_idx")]

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


class ItemVariant(TenantScopedModel):
    """The sellable, stockable unit (SKU = size × colour)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="variants")
    size = models.TextField()
    color = models.TextField()
    color_hex = models.TextField(null=True, blank=True)
    sku = models.TextField()
    barcode = models.TextField(null=True, blank=True)
    mrp = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    min_selling_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    max_selling_price = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    # Moving weighted average — written by the inventory service only,
    # visible only with pricing.view_cost. Catalog endpoints never touch it.
    avg_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "item_variant"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "sku"], name="variant_tenant_sku_uniq"),
            # The POS hot path — partial: only rows that HAVE a barcode.
            models.UniqueConstraint(
                fields=["tenant", "barcode"],
                condition=Q(barcode__isnull=False),
                name="variant_tenant_barcode_uniq",
            ),
            models.UniqueConstraint(fields=["item", "size", "color"], name="variant_combo_uniq"),
        ]
        indexes: ClassVar = [
            models.Index(fields=["tenant", "item"], name="variant_tenant_item_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.sku} ({self.item.name})"
