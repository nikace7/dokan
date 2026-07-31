"""Payments — money in/out after billing, and cash sessions.

Invariant 3 drives the design: completed invoices are NEVER updated. Due
reduction is ledger-derived (dues − credit notes − receipts), exactly the
credit-note pattern from the returns slice — ``paid_amount``/``due_amount``
on invoices are write-once-at-completion truths; receipts live here.

Both tables are tenant-scoped and RLS-protected. ``payment`` is APPEND-ONLY
(the migration REVOKEs UPDATE/DELETE from the app role, like
stock_movement): a wrong receipt is reversed with a counter-entry, never
edited.
"""

import uuid
from typing import ClassVar

from django.db import models
from django.db.models import Q

from core.models import TenantScopedModel


class Payment(TenantScopedModel):
    """One receipt (money IN from a customer) or payment (money OUT to a supplier)."""

    class Direction(models.TextChoices):
        RECEIPT = "RECEIPT"
        PAYMENT = "PAYMENT"

    class PartyType(models.TextChoices):
        CUSTOMER = "CUSTOMER"
        SUPPLIER = "SUPPLIER"

    class Method(models.TextChoices):
        CASH = "CASH"
        ESEWA = "ESEWA"
        KHALTI = "KHALTI"
        FONEPAY = "FONEPAY"
        CARD = "CARD"
        BANK = "BANK"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey("tenants.Branch", on_delete=models.PROTECT, related_name="+")
    direction = models.TextField(choices=Direction.choices)
    party_type = models.TextField(choices=PartyType.choices)
    customer = models.ForeignKey(
        "customers.Customer", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    supplier = models.ForeignKey(
        "purchasing.Supplier", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    method = models.TextField(choices=Method.choices)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    ref_no = models.TextField(null=True, blank=True)  # gateway/bank reference
    note = models.TextField(null=True, blank=True)
    business_date_ad = models.DateField()
    business_date_bs = models.CharField(max_length=10)
    fiscal_year_bs = models.CharField(max_length=7)
    idempotency_key = models.TextField()
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = "payment"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"], name="payment_tenant_idempotency_uniq"
            ),
            # Exactly the party matching the direction is set.
            models.CheckConstraint(
                condition=(
                    Q(direction="RECEIPT", customer__isnull=False, supplier__isnull=True)
                    | Q(direction="PAYMENT", supplier__isnull=False, customer__isnull=True)
                ),
                name="payment_party_check",
            ),
        ]
        indexes: ClassVar = [
            models.Index(
                fields=["tenant", "party_type", "customer", "business_date_bs"],
                name="payment_tenant_customer_idx",
            ),
            models.Index(
                fields=["tenant", "party_type", "supplier", "business_date_bs"],
                name="payment_tenant_supplier_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.direction} {self.amount} ({self.method})"


class PaymentAllocation(TenantScopedModel):
    """Links part of a receipt/payment to a specific open invoice.

    Two nullable FKs (sales_invoice / purchase_invoice), exactly one set —
    enforced by CHECK and by the service (receipts allocate against
    COMPLETED sales, supplier payments against CONFIRMED purchases).
    Allocation never touches the invoice row (invariant 3); outstanding is
    derived as due_amount − Σ allocations.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name="allocations")
    sales_invoice = models.ForeignKey(
        "sales.SalesInvoice", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    purchase_invoice = models.ForeignKey(
        "purchasing.PurchaseInvoice",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
    )
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "payment_allocation"
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(sales_invoice__isnull=False, purchase_invoice__isnull=True)
                    | Q(purchase_invoice__isnull=False, sales_invoice__isnull=True)
                ),
                name="allocation_invoice_check",
            )
        ]
        indexes: ClassVar = [
            models.Index(fields=["payment"], name="allocation_payment_idx"),
            models.Index(fields=["tenant", "sales_invoice"], name="allocation_tenant_sale_idx"),
            models.Index(
                fields=["tenant", "purchase_invoice"], name="allocation_tenant_purchase_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.amount} of {self.payment_id}"


class CashSession(TenantScopedModel):
    """Drawer open/close with variance (design §1.2 day close).

    One OPEN session per branch (partial unique WHERE closed_at IS NULL).
    expected_cash/variance are snapshotted on the row at close time.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey("tenants.Branch", on_delete=models.PROTECT, related_name="+")
    opened_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")
    opened_at = models.DateTimeField()
    opening_float = models.DecimalField(max_digits=14, decimal_places=2)
    closed_by = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    counted_cash = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    expected_cash = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    variance = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    note = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "cash_session"
        constraints = [
            models.UniqueConstraint(
                fields=["branch"],
                condition=Q(closed_at__isnull=True),
                name="cash_session_one_open_per_branch",
            )
        ]
        indexes: ClassVar = [
            models.Index(
                fields=["tenant", "branch", "-opened_at"], name="cash_session_tenant_branch_idx"
            )
        ]

    def __str__(self) -> str:
        state = "OPEN" if self.closed_at is None else "CLOSED"
        return f"Cash session {self.branch.code} ({state})"
