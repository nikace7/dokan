"""Write-side business logic for payments — receipts and supplier payments.

Invariant map (ARCHITECTURE §6):
- #3: completed invoices are NEVER updated. Allocations and outstanding are
  ledger-derived (due_amount − Σ allocations; dues − credit notes −
  receipts), never written back onto the invoice.
- #8: Idempotency-Key is mandatory; a replay returns the original payment.
- Payments are append-only (DB-level REVOKE); a mistake is reversed with a
  linked negative counter-entry, never edited.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.audit.services import audit
from apps.payments.models import CashSession, Payment, PaymentAllocation
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
    reversal_of: Payment | None = None,
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
        reversal_of=reversal_of,
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


def reverse_payment(
    tenant: "Tenant",
    *,
    payment: Payment,
    reason: str,
    idempotency_key: str,
    created_by: "User",
    business_date: date | None = None,
) -> PaymentResult:
    """Reverse one payment with a linked, negative counter-entry.

    The original row and its allocations remain immutable. Locking the
    original serializes competing reversals and guarantees one counter-entry.
    """
    key = _validate_key(idempotency_key)
    reason = reason.strip()
    if not reason:
        raise ServiceError("REVERSAL_REASON_REQUIRED", "A reversal reason is required.")
    if payment.tenant_id != tenant.pk:
        raise ServiceError("PAYMENT_NOT_FOUND", "Payment not found.", http_status=404)

    try:
        with transaction.atomic():
            original = (
                Payment.objects.select_for_update().filter(tenant=tenant, pk=payment.pk).first()
            )
            if original is None:
                raise ServiceError("PAYMENT_NOT_FOUND", "Payment not found.", http_status=404)

            existing = Payment.objects.filter(tenant=tenant, idempotency_key=key).first()
            if existing is not None:
                if existing.reversal_of_id == original.pk:
                    return PaymentResult(payment=existing, replayed=True)
                raise ServiceError(
                    "IDEMPOTENCY_KEY_REUSED",
                    "This Idempotency-Key belongs to another payment.",
                    http_status=409,
                )

            if (
                original.reversal_of_id is not None
                or Payment.objects.filter(tenant=tenant, reversal_of=original).exists()
            ):
                raise ServiceError(
                    "PAYMENT_ALREADY_REVERSED",
                    "This payment has already been reversed.",
                    http_status=409,
                )

            reversal = _write_payment(
                tenant,
                branch=original.branch,
                direction=original.direction,
                party_type=original.party_type,
                customer=original.customer,
                supplier=original.supplier,
                amount=-original.amount,
                method=original.method,
                ref_no=f"REVERSAL-{original.pk}",
                note=reason,
                allocations=[
                    {
                        "sales_invoice": allocation.sales_invoice,
                        "purchase_invoice": allocation.purchase_invoice,
                        "amount": -allocation.amount,
                    }
                    for allocation in original.allocations.select_related(
                        "sales_invoice", "purchase_invoice"
                    )
                ],
                idempotency_key=key,
                created_by=created_by,
                business_date=business_date,
                reversal_of=original,
            )
            audit(
                tenant,
                actor=created_by,
                action="payment.reverse",
                target_type="payment",
                target_id=original,
                before={"reversal_id": None},
                after={"reversal_id": str(reversal.pk), "reason": reason},
            )
            return PaymentResult(payment=reversal, replayed=False)
    except IntegrityError as exc:
        if "idempotency" not in str(exc):
            raise
        existing = Payment.objects.get(tenant=tenant, idempotency_key=key)
        if existing.reversal_of_id == payment.pk:
            return PaymentResult(payment=existing, replayed=True)
        raise ServiceError(
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key belongs to another payment.",
            http_status=409,
        ) from exc


# --- Cash sessions (day close, design §1.2) ------------------------------------


def get_open_session(tenant: "Tenant", branch: "Branch") -> CashSession | None:
    """Return the branch's currently open session, if any."""
    return CashSession.objects.filter(tenant=tenant, branch=branch, closed_at__isnull=True).first()


def require_open_session(tenant: "Tenant", branch: "Branch") -> CashSession:
    """Require an open drawer before a POS completion can move stock."""
    session = get_open_session(tenant, branch)
    if session is None:
        raise ServiceError(
            "CASH_SESSION_REQUIRED",
            "Open a cash session before completing a POS sale.",
            http_status=409,
        )
    return session


def open_session(
    tenant: "Tenant",
    *,
    branch: "Branch",
    opening_float: Decimal,
    opened_by: "User",
    note: str = "",
) -> CashSession:
    """Open the drawer for a branch. One OPEN session per branch."""
    opening_float = quantize_money(opening_float)
    if opening_float < _ZERO:
        raise ServiceError("FLOAT_INVALID", "Opening float cannot be negative.")
    if get_open_session(tenant, branch) is not None:
        raise ServiceError(
            "SESSION_ALREADY_OPEN",
            "This branch already has an open cash session.",
            http_status=409,
        )
    session = CashSession(
        tenant=tenant,
        branch=branch,
        opened_by=opened_by,
        opened_at=timezone.now(),
        opening_float=opening_float,
        note=note or None,
    )
    session.save()
    return session


def _expected_cash(tenant: "Tenant", session: CashSession) -> Decimal:
    """Expected drawer total at close from persisted cash movements.

    = opening float + CASH sale tenders + CASH receipts
    − CASH supplier payments − CASH refunds.
    """
    from apps.sales.models import SalesInvoice

    sales = SalesInvoice.objects.filter(
        tenant=tenant,
        branch=session.branch,
        doc_type=SalesInvoice.DocType.SALE,
        status=SalesInvoice.Status.COMPLETED,
        created_at__gte=session.opened_at,
    ).values_list("tenders", flat=True)
    cash_sales = sum(
        (
            Decimal(str(tender.get("amount", "0")))
            for tenders in sales
            for tender in tenders
            if tender.get("method") == Payment.Method.CASH
        ),
        _ZERO,
    )

    cash_receipts = (
        Payment.objects.filter(
            tenant=tenant,
            branch=session.branch,
            direction=Payment.Direction.RECEIPT,
            method=Payment.Method.CASH,
            created_at__gte=session.opened_at,
        ).aggregate(total=Sum("amount"))["total"]
        or _ZERO
    )

    cash_supplier_payments = (
        Payment.objects.filter(
            tenant=tenant,
            branch=session.branch,
            direction=Payment.Direction.PAYMENT,
            method=Payment.Method.CASH,
            created_at__gte=session.opened_at,
        ).aggregate(total=Sum("amount"))["total"]
        or _ZERO
    )

    cash_refunds = _ZERO
    returns = SalesInvoice.objects.filter(
        tenant=tenant,
        branch=session.branch,
        doc_type=SalesInvoice.DocType.RETURN,
        created_at__gte=session.opened_at,
    ).values_list("refunds", flat=True)
    for refunds in returns:
        for refund in refunds:
            if refund.get("method") == "CASH":
                cash_refunds += Decimal(str(refund.get("amount", "0")))

    return quantize_money(
        session.opening_float + cash_sales + cash_receipts - cash_supplier_payments - cash_refunds
    )


def close_session(
    tenant: "Tenant",
    *,
    session: CashSession,
    counted_cash: Decimal,
    closed_by: "User",
) -> CashSession:
    """Close the drawer: snapshot expected, counted, and variance."""
    if session.closed_at is not None:
        raise ServiceError(
            "SESSION_ALREADY_CLOSED", "This cash session is already closed.", http_status=409
        )
    counted_cash = quantize_money(counted_cash)
    if counted_cash < _ZERO:
        raise ServiceError("COUNT_INVALID", "Counted cash cannot be negative.")
    session.expected_cash = _expected_cash(tenant, session)
    session.counted_cash = counted_cash
    session.variance = quantize_money(counted_cash - session.expected_cash)
    session.closed_by = closed_by
    session.closed_at = timezone.now()
    session.save()
    return session
