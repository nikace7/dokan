"""Sales models — invoices, invoice lines, and the gapless number sequence.

Tenant-scoped, RLS-protected; every composite index leads with tenant_id.

Invariants honoured here (AGENTS.md):
- **#3 Completed invoices are never updated or deleted.** HELD bills are
  working state; COMPLETED is terminal for this slice (returns/corrections
  come later as separate RETURN documents with ``original_invoice_id``).
- **#2 cost_at_sale is snapshotted at sale time** on every line — never
  recomputed, never updated.
- **#8 Idempotency-Key is mandatory** on sale creation; the key is stored
  on the invoice and unique per tenant.
"""

import uuid
from typing import ClassVar

from django.db import models
from django.db.models import Q

from core.models import TenantScopedModel


class NumberSequence(TenantScopedModel):
    """Gapless numbering state per branch per fiscal year (core/numbering.py).

    ``core.numbering.allocate_number`` does INSERT ... ON CONFLICT + SELECT
    ... FOR UPDATE against this table inside the caller's transaction, so a
    rollback releases the number. The raw INSERT omits ``id`` — the
    migration adds a DB-level ``gen_random_uuid()`` default for it.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey("tenants.Branch", on_delete=models.CASCADE, related_name="+")
    doc_type = models.TextField()  # e.g. SALE, RETURN, PURCHASE
    fiscal_year_bs = models.CharField(max_length=7)  # '2082-83'
    prefix = models.TextField()  # e.g. INV
    next_number = models.IntegerField()

    class Meta:
        db_table = "number_sequence"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "branch", "doc_type", "fiscal_year_bs"],
                name="number_sequence_uniq",
            )
        ]


class SalesInvoice(TenantScopedModel):
    """A bill. HELD → COMPLETED (terminal); HELD → CANCELLED (same-day void)."""

    class DocType(models.TextChoices):
        SALE = "SALE"
        RETURN = "RETURN"
        EXCHANGE_OUT = "EXCHANGE_OUT"

    class Status(models.TextChoices):
        HELD = "HELD"
        COMPLETED = "COMPLETED"
        CANCELLED = "CANCELLED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey("tenants.Branch", on_delete=models.PROTECT, related_name="+")
    # Gapless int per branch per fiscal year; NULL while HELD (assigned at
    # completion). Partial unique below keeps completed numbers unique.
    invoice_no = models.IntegerField(null=True, blank=True)
    doc_type = models.TextField(choices=DocType.choices, default=DocType.SALE)
    original_invoice = models.ForeignKey(
        "self", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    exchange_group_id = models.UUIDField(null=True, blank=True)
    customer = models.ForeignKey(
        "customers.Customer", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    rate_type = models.ForeignKey("pricing.RateType", on_delete=models.PROTECT, related_name="+")
    salesperson = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, related_name="+", null=True, blank=True
    )
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    discount_reason = models.TextField(null=True, blank=True)
    discount_approved_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
        db_column="discount_approved_by",
    )
    taxable_amount = models.DecimalField(max_digits=14, decimal_places=2)
    vat_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    round_off = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2)
    due_amount = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.TextField(choices=Status.choices, default=Status.HELD)
    is_vat_bill = models.BooleanField(default=False)
    print_count = models.IntegerField(default=0)
    ird_synced_at = models.DateTimeField(null=True, blank=True)  # CBMS (Phase 2)
    ird_sync_error = models.TextField(null=True, blank=True)
    datetime_ad = models.DateTimeField()
    business_date_ad = models.DateField()
    business_date_bs = models.CharField(max_length=10)
    fiscal_year_bs = models.CharField(max_length=7)
    device_id = models.TextField(null=True, blank=True)
    idempotency_key = models.TextField()
    # RETURN docs only: how the credit was settled — [{method, amount}],
    # method CASH/ESEWA/… for money back, CREDIT_NOTE for udharo reduction,
    # EXCHANGE_APPLIED for credit consumed by an exchange sale.
    refunds = models.JSONField(default=list)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = "sales_invoice"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"], name="invoice_tenant_idempotency_uniq"
            ),
            # Completed numbers are unique per doc_type series; HELD bills
            # have no number yet.
            models.UniqueConstraint(
                fields=["tenant", "branch", "fiscal_year_bs", "doc_type", "invoice_no"],
                condition=Q(invoice_no__isnull=False),
                name="invoice_gapless_number_uniq",
            ),
        ]
        indexes: ClassVar = [
            models.Index(
                fields=["tenant", "branch", "business_date_bs"], name="invoice_tenant_date_idx"
            ),
            models.Index(
                fields=["tenant", "fiscal_year_bs", "doc_type"], name="invoice_tenant_fy_idx"
            ),
            models.Index(
                fields=["tenant", "customer", "-created_at"], name="invoice_tenant_customer_idx"
            ),
            models.Index(
                fields=["tenant", "due_amount"],
                condition=Q(due_amount__gt=0),
                name="invoice_tenant_dues_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.doc_type} {self.invoice_no or 'HELD'} ({self.status})"


class SalesInvoiceItem(TenantScopedModel):
    """One bill line. cost_at_sale is a SNAPSHOT — never recomputed."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(SalesInvoice, on_delete=models.PROTECT, related_name="items")
    variant = models.ForeignKey("catalog.ItemVariant", on_delete=models.PROTECT, related_name="+")
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    rate_type = models.ForeignKey("pricing.RateType", on_delete=models.PROTECT, related_name="+")
    unit_price = models.DecimalField(max_digits=14, decimal_places=2)
    discount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=14, decimal_places=2)
    cost_at_sale = models.DecimalField(max_digits=14, decimal_places=2)
    returned_qty = models.DecimalField(max_digits=12, decimal_places=3, default=0)

    class Meta:
        db_table = "sales_invoice_item"
        indexes: ClassVar = [
            models.Index(fields=["invoice"], name="invoice_item_invoice_idx"),
            models.Index(fields=["variant", "invoice"], name="invoice_item_variant_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.variant.sku} × {self.qty} @ {self.unit_price}"
