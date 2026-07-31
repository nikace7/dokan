"""Write-side business logic for payments — receipts and supplier payments.

Invariant map (AGENTS.md):
- #3: completed invoices are NEVER updated. Allocations and outstanding are
  ledger-derived (due_amount − Σ allocations; dues − credit notes −
  receipts), never written back onto the invoice.
- #8: Idempotency-Key is mandatory; a replay returns the original payment.
- Payments are append-only (DB-level REVOKE); a mistake is reversed with a
  counter-entry in a later slice, never edited.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.payments.models import Payment, PaymentAllocation
from apps.payments.selectors import invoice_outstanding
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.customers.models import Customer
    from apps.purchasing.models import Supplier
    from apps.tenants.models import Branch, Tenant

_ZERO = Decimal("0")


@dataclass(frozen=True)
class PaymentResult:
    payment: Payment
    replayed: bool


def _validate_key(idempotency_key: str) -> str:
    key = idempotency_key.strip()
    if not key:
        raise ServiceError("IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required.")
    return key


def _validate_common(amount: Decimal, method: str) -> Decimal:
    amount = quantize_money(amount)
    if amount <= _ZERO:
        raise ServiceError("PAYMENT_AMOUNT_INVALID", "Amount must be greater than zero.")
    if method not in set(Payment.Method.values):
        raise ServiceError("PAYMENT_METHOD_INVALID", f"Unknown payment method: {method}.")
    return amount


def _validate_sale_allocations(
    tenant: "Tenant",
    *,
    customer: "Customer",
    allocations: list[dict[str, Any]],
    amount: Decimal,
) -> None:
    """Each allocated invoice: COMPLETED sale of this customer, within its
    derived outstanding; Σ allocations ≤ the receipt amount."""
    total_allocated = _ZERO
    for allocation in allocations:
        invoice = allocation["sales_invoice"]
        allocated_amount = quantize_money(allocation["amount"])
        if allocated_amount <= _ZERO:
            raise ServiceError("ALLOCATION_AMOUNT_INVALID", "Allocation amounts must be positive.")
        if (
            invoice.customer_id != customer.pk
            or invoice.doc_type != "SALE"
            or invoice.status != "COMPLETED"
        ):
            raise ServiceError(
                "ALLOCATION_INVOICE_INVALID",
                "Allocations must target completed sales of this customer.",
            )
        outstanding = invoice_outstanding(tenant, invoice=invoice)
        if allocated_amount > outstanding:
            raise ServiceError(
                "ALLOCATION_EXCEEDS_OUTSTANDING",
                f"Invoice {invoice.invoice_no} has only {outstanding} outstanding.",
            )
        total_allocated += allocated_amount
    if total_allocated > amount:
        raise ServiceError("ALLOCATION_EXCEEDS_AMOUNT", "Allocations exceed the receipt amount.")


def _validate_purchase_allocations(
    tenant: "Tenant",
    *,
    supplier: "Supplier",
    allocations: list[dict[str, Any]],
    amount: Decimal,
) -> None:
    total_allocated = _ZERO
    for allocation in allocations:
        invoice = allocation["purchase_invoice"]
        allocated_amount = quantize_money(allocation["amount"])
        if allocated_amount <= _ZERO:
            raise ServiceError("ALLOCATION_AMOUNT_INVALID", "Allocation amounts must be positive.")
        if invoice.supplier_id != supplier.pk or invoice.status != "CONFIRMED":
            raise ServiceError(
                "ALLOCATION_INVOICE_INVALID",
                "Allocations must target confirmed purchases of this supplier.",
            )
        outstanding = invoice_outstanding(tenant, invoice=invoice)
        if allocated_amount > outstanding:
            raise ServiceError(
                "ALLOCATION_EXCEEDS_OUTSTANDING",
                f"Purchase {invoice.invoice_no} has only {outstanding} outstanding.",
            )
        total_allocated += allocated_amount
    if total_allocated > amount:
        raise ServiceError("ALLOCATION_EXCEEDS_AMOUNT", "Allocations exceed the payment amount.")


def _write_payment(
    tenant: "Tenant",
    *,
    branch: "Branch",
    direction: str,
    party_type: str,
    amount: Decimal,
    method: str,
    ref_no: str,
    note: str,
    allocations: list[dict[str, Any]],
    idempotency_key: str,
    created_by: "User",
    business_date: date | None,
    customer: "Customer | None" = None,
    supplier: "Supplier | None" = None,
) -> Payment:
    date_ad = business_date or timezone.localdate()
    payment = Payment(
        tenant=tenant,
        branch=branch,
        direction=direction,
        party_type=party_type,
        customer=customer,
        supplier=supplier,
        method=method,
        amount=amount,
        ref_no=ref_no or None,
        note=note or None,
        business_date_ad=date_ad,
        business_date_bs=ad_to_bs(date_ad),
        fiscal_year_bs=fiscal_year_bs(date_ad),
        idempotency_key=idempotency_key,
        created_by=created_by,
    )
    payment.save()
    PaymentAllocation.objects.bulk_create(
        [
            PaymentAllocation(
                tenant=tenant,
                payment=payment,
                sales_invoice=a.get("sales_invoice"),
                purchase_invoice=a.get("purchase_invoice"),
                amount=quantize_money(a["amount"]),
            )
            for a in allocations
        ]
    )
    return payment


def record_receipt(
    tenant: "Tenant",
    *,
    branch: "Branch",
    customer: "Customer",
    amount: Decimal,
    method: str,
    allocations: list[dict[str, Any]] | None = None,
    ref_no: str = "",
    note: str = "",
    idempotency_key: str,
    created_by: "User",
    business_date: date | None = None,
) -> PaymentResult:
    """Record money IN from a customer, optionally allocated to open sales.

    Unallocated receipts are allowed — an advance on account, which still
    reduces the customer's derived outstanding (see selectors).
    """
    key = _validate_key(idempotency_key)
    amount = _validate_common(amount, method)
    allocations = allocations or []
    _validate_sale_allocations(tenant, customer=customer, allocations=allocations, amount=amount)
    try:
        with transaction.atomic():
            payment = _write_payment(
                tenant,
                branch=branch,
                direction=Payment.Direction.RECEIPT,
                party_type=Payment.PartyType.CUSTOMER,
                customer=customer,
                amount=amount,
                method=method,
                ref_no=ref_no,
                note=note,
                allocations=allocations,
                idempotency_key=key,
                created_by=created_by,
                business_date=business_date,
            )
            return PaymentResult(payment=payment, replayed=False)
    except IntegrityError as exc:
        if "idempotency" in str(exc):
            original = Payment.objects.get(tenant=tenant, idempotency_key=key)
            return PaymentResult(payment=original, replayed=True)
        raise


def record_payment(
    tenant: "Tenant",
    *,
    branch: "Branch",
    supplier: "Supplier",
    amount: Decimal,
    method: str,
    allocations: list[dict[str, Any]] | None = None,
    ref_no: str = "",
    note: str = "",
    idempotency_key: str,
    created_by: "User",
    business_date: date | None = None,
) -> PaymentResult:
    """Record money OUT to a supplier, optionally allocated to purchases."""
    key = _validate_key(idempotency_key)
    amount = _validate_common(amount, method)
    allocations = allocations or []
    _validate_purchase_allocations(
        tenant, supplier=supplier, allocations=allocations, amount=amount
    )
    try:
        with transaction.atomic():
            payment = _write_payment(
                tenant,
                branch=branch,
                direction=Payment.Direction.PAYMENT,
                party_type=Payment.PartyType.SUPPLIER,
                supplier=supplier,
                amount=amount,
                method=method,
                ref_no=ref_no,
                note=note,
                allocations=allocations,
                idempotency_key=key,
                created_by=created_by,
                business_date=business_date,
            )
            return PaymentResult(payment=payment, replayed=False)
    except IntegrityError as exc:
        if "idempotency" in str(exc):
            original = Payment.objects.get(tenant=tenant, idempotency_key=key)
            return PaymentResult(payment=original, replayed=True)
        raise
