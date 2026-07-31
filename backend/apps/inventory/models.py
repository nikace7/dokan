"""Inventory models — the stock ledger and its projection.

Invariant #1 (AGENTS.md, docs/DATABASE_SCHEMA.md §6): **stock changes only
via ``stock_movement``** (immutable, append-only ledger — the migration
REVOKEs UPDATE/DELETE from the app role). ``stock_level`` is a projection
written by the inventory service in the same transaction as its ledger rows,
never by anyone else; a monthly job re-derives it and alerts on drift.

Both tables are tenant-scoped, RLS-protected, and every composite index
leads with tenant_id.
"""

import uuid
from typing import ClassVar

from django.db import models
from django.db.models import Q

from core.models import TenantScopedModel


class StockLevel(TenantScopedModel):
    """Fast read model of current stock — a PROJECTION of the ledger."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey("tenants.Branch", on_delete=models.CASCADE, related_name="+")
    variant = models.ForeignKey(
        "catalog.ItemVariant", on_delete=models.CASCADE, related_name="stock_levels"
    )
    qty_on_hand = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    qty_reserved = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    # Moving weighted average per branch — pricing.view_cost only.
    avg_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        db_table = "stock_level"
        constraints = [
            models.UniqueConstraint(
                fields=["branch", "variant"], name="stock_level_branch_variant_uniq"
            )
        ]
        indexes: ClassVar = [
            # Low/out-of-stock scans (docs/DATABASE_SCHEMA.md §6.1).
            models.Index(
                fields=["tenant", "branch"],
                condition=Q(qty_on_hand__lte=0),
                name="stock_level_low_idx",
            )
        ]

    def __str__(self) -> str:
        return f"{self.variant.sku} @ {self.branch.code}: {self.qty_on_hand}"


class StockMovement(TenantScopedModel):
    """One immutable ledger entry. The ONLY way stock changes."""

    class MovementType(models.TextChoices):
        OPENING = "OPENING"
        PURCHASE = "PURCHASE"
        SALE = "SALE"
        SALE_RETURN = "SALE_RETURN"
        PURCHASE_RETURN = "PURCHASE_RETURN"
        TRANSFER_IN = "TRANSFER_IN"
        TRANSFER_OUT = "TRANSFER_OUT"
        ADJUSTMENT = "ADJUSTMENT"
        DAMAGE = "DAMAGE"
        COUNT = "COUNT"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey("tenants.Branch", on_delete=models.CASCADE, related_name="+")
    variant = models.ForeignKey(
        "catalog.ItemVariant", on_delete=models.CASCADE, related_name="stock_movements"
    )
    type = models.TextField(choices=MovementType.choices)
    qty_delta = models.DecimalField(max_digits=12, decimal_places=3)  # signed
    unit_cost = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )  # pricing.view_cost only
    balance_after = models.DecimalField(max_digits=12, decimal_places=3)
    ref_type = models.TextField(null=True, blank=True)  # e.g. sales_invoice, purchase_invoice
    ref_id = models.UUIDField(null=True, blank=True)
    note = models.TextField(null=True, blank=True)
    # Denormalized at write time via core/calendar/bs.py — reports become
    # plain indexed BETWEEN scans, no conversion in SQL.
    business_date_ad = models.DateField()
    business_date_bs = models.CharField(max_length=10)
    fiscal_year_bs = models.CharField(max_length=7)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, related_name="+", null=True, blank=True
    )

    class Meta:
        db_table = "stock_movement"
        indexes: ClassVar = [
            models.Index(
                fields=["tenant", "variant", "-created_at"], name="movement_tenant_variant_idx"
            ),
            models.Index(
                fields=["tenant", "branch", "business_date_bs"], name="movement_tenant_date_idx"
            ),
            models.Index(fields=["tenant", "ref_type", "ref_id"], name="movement_tenant_ref_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.type} {self.qty_delta} {self.variant.sku} @ {self.business_date_bs}"


class StockBatch(TenantScopedModel):
    """Receipt batch per purchase line — exists so FIFO could be revived
    later (costing today is moving weighted average, docs/DATABASE_SCHEMA
    §6.3). Written only by the purchase-confirm pipeline."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey("tenants.Branch", on_delete=models.CASCADE, related_name="+")
    variant = models.ForeignKey("catalog.ItemVariant", on_delete=models.CASCADE, related_name="+")
    purchase_item = models.ForeignKey(
        "purchasing.PurchaseInvoiceItem",
        on_delete=models.CASCADE,
        related_name="batches",
        null=True,
        blank=True,
    )
    qty_in = models.DecimalField(max_digits=12, decimal_places=3)
    qty_remaining = models.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=2)
    landed_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    received_at = models.DateTimeField()

    class Meta:
        db_table = "stock_batch"
        indexes: ClassVar = [
            models.Index(
                fields=["tenant", "variant", "received_at"], name="batch_tenant_variant_idx"
            )
        ]

    def __str__(self) -> str:
        return f"Batch {self.variant.sku} × {self.qty_in} @ {self.landed_cost or self.unit_cost}"


class StockTransfer(TenantScopedModel):
    """Move stock between branches with an in-transit state.

    In-transit model (documented): qty leaves the source on SEND
    (TRANSFER_OUT) and arrives at the destination on RECEIVE
    (TRANSFER_IN). Between the two, the stock is in NEITHER branch's
    qty_on_hand — in-transit quantity = Σ(qty_sent − qty_received) over
    SENT transfers, exposed via selectors.in_transit. The monthly drift
    job must add in-transit to the reconciliation.
    """

    class Status(models.TextChoices):
        DRAFT = "DRAFT"
        SENT = "SENT"
        RECEIVED = "RECEIVED"
        CANCELLED = "CANCELLED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    from_branch = models.ForeignKey("tenants.Branch", on_delete=models.PROTECT, related_name="+")
    to_branch = models.ForeignKey("tenants.Branch", on_delete=models.PROTECT, related_name="+")
    status = models.TextField(choices=Status.choices, default=Status.DRAFT)
    sent_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")
    note = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "stock_transfer"
        constraints = [
            models.CheckConstraint(
                condition=~Q(from_branch=models.F("to_branch")),
                name="transfer_branch_check",
            )
        ]
        indexes: ClassVar = [
            models.Index(fields=["tenant", "from_branch"], name="transfer_tenant_from_idx"),
            models.Index(fields=["tenant", "to_branch"], name="transfer_tenant_to_idx"),
            models.Index(fields=["tenant", "status"], name="transfer_tenant_status_idx"),
        ]

    def __str__(self) -> str:
        return f"Transfer {self.from_branch.code} → {self.to_branch.code} ({self.status})"


class StockTransferItem(TenantScopedModel):
    """One transfer line. unit_cost snapshots the source's avg_cost at
    send time (documented addition to the schema sketch): the TRANSFER_IN
    at destination folds in at exactly this basis, so the tenant-wide
    average is undisturbed."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transfer = models.ForeignKey(StockTransfer, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey("catalog.ItemVariant", on_delete=models.PROTECT, related_name="+")
    qty_sent = models.DecimalField(max_digits=12, decimal_places=3)
    qty_received = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "stock_transfer_item"
        indexes: ClassVar = [
            models.Index(fields=["transfer"], name="transfer_item_transfer_idx"),
            models.Index(fields=["tenant", "variant"], name="transfer_item_variant_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.variant.sku} × {self.qty_sent}"


class StockCount(TenantScopedModel):
    """Physical count of a branch. One OPEN count per branch at a time."""

    class Status(models.TextChoices):
        OPEN = "OPEN"
        FINALIZED = "FINALIZED"
        CANCELLED = "CANCELLED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey("tenants.Branch", on_delete=models.PROTECT, related_name="+")
    status = models.TextField(choices=Status.choices, default=Status.OPEN)
    started_at = models.DateTimeField()
    finalized_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = "stock_count"
        constraints = [
            models.UniqueConstraint(
                fields=["branch"],
                condition=Q(status="OPEN"),
                name="stock_count_one_open_per_branch",
            )
        ]
        indexes: ClassVar = [
            models.Index(fields=["tenant", "branch", "-started_at"], name="count_tenant_branch_idx")
        ]

    def __str__(self) -> str:
        return f"Count {self.branch.code} ({self.status})"


class StockCountItem(TenantScopedModel):
    """One count line. system_qty is the snapshot at start and is never
    rewritten; variance = counted_qty − system_qty at entry."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    count = models.ForeignKey(StockCount, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey("catalog.ItemVariant", on_delete=models.PROTECT, related_name="+")
    system_qty = models.DecimalField(max_digits=12, decimal_places=3)
    counted_qty = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    variance = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    note = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "stock_count_item"
        constraints = [
            models.UniqueConstraint(
                fields=["count", "variant"], name="count_item_count_variant_uniq"
            )
        ]
        indexes: ClassVar = [
            models.Index(fields=["tenant", "variant"], name="count_item_variant_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.variant.sku}: {self.system_qty} → {self.counted_qty}"
