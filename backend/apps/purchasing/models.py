"""Suppliers — the party a shop buys from (payables side).

Tenant-scoped, RLS-protected. opening_balance positive = we owe them.
"""

import uuid

from django.db import models
from django.db.models import Q

from core.models import TenantScopedModel


class Supplier(TenantScopedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.TextField()
    phone = models.TextField(null=True, blank=True)
    pan_no = models.TextField(null=True, blank=True)  # needed on VAT purchase register
    address = models.TextField(null=True, blank=True)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit_days = models.IntegerField(default=0)  # for payable due dates
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "supplier"
        indexes = [models.Index(fields=["tenant", "name"], name="supplier_tenant_name_idx")]

    def __str__(self) -> str:
        return self.name


class PurchaseInvoice(TenantScopedModel):
    """A supplier bill. DRAFT is editable; CONFIRMED posts stock + batches."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT"
        CONFIRMED = "CONFIRMED"
        CANCELLED = "CANCELLED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey("tenants.Branch", on_delete=models.PROTECT, related_name="+")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="invoices")
    # Our gapless number per branch per fiscal year (PURCHASE series);
    # NULL while DRAFT — assigned at confirm. supplier_bill_no is the
    # vendor's own number, not ours.
    invoice_no = models.IntegerField(null=True, blank=True)
    supplier_bill_no = models.TextField(null=True, blank=True)
    bill_date_ad = models.DateField()
    bill_date_bs = models.CharField(max_length=10)
    fiscal_year_bs = models.CharField(max_length=7)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    discount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    taxable_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    vat_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    other_charges = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    paid_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    due_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.TextField(choices=Status.choices, default=Status.DRAFT)
    is_vat_bill = models.BooleanField(default=False)
    note = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = "purchase_invoice"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "branch", "fiscal_year_bs", "invoice_no"],
                condition=Q(invoice_no__isnull=False),
                name="purchase_gapless_number_uniq",
            )
        ]
        indexes = [
            models.Index(
                fields=["tenant", "supplier", "bill_date_bs"], name="purchase_tenant_supplier_idx"
            ),
            models.Index(fields=["tenant", "status"], name="purchase_tenant_status_idx"),
        ]

    def __str__(self) -> str:
        return f"Purchase {self.invoice_no or 'DRAFT'} from {self.supplier.name} ({self.status})"


class PurchaseInvoiceItem(TenantScopedModel):
    """One purchase bill line. Carries tenant_id per the global rule."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(PurchaseInvoice, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey("catalog.ItemVariant", on_delete=models.PROTECT, related_name="+")
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=2)
    discount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "purchase_invoice_item"
        indexes = [
            models.Index(fields=["invoice"], name="purchase_item_invoice_idx"),
            models.Index(fields=["tenant", "variant"], name="purchase_item_variant_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.variant.sku} × {self.qty} @ {self.unit_cost}"
