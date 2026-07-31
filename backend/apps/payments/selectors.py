"""Read-side queries for payments — the CANONICAL outstanding derivations.

One rule set, one home (previously half-lived in customers/selectors.py;
that module now delegates here):

- ``customer_outstanding`` = opening_balance + Σ COMPLETED sale dues
  − credit notes (CREDIT_NOTE entries in RETURN refunds)
  − receipts (ALL RECEIPT payments, allocated or not — an unallocated
  advance still reduces what the customer owes).
- ``supplier_payable`` = opening_balance + Σ CONFIRMED purchase dues
  − supplier payments (PAYMENT direction).
- Per-invoice outstanding = due_amount − Σ allocations against it.
- Ledgers are computed chronological views (no party_ledger_entry table
  yet — see deferral note in apps/payments/services.py docstring).
- Aging buckets outstanding by invoice age; unallocated money (advances +
  credit notes) reduces the OLDEST bucket first (documented rule).
"""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any, NamedTuple
from uuid import UUID

from django.db.models import QuerySet, Sum
from django.utils import timezone

from apps.payments.models import Payment, PaymentAllocation
from apps.purchasing.models import PurchaseInvoice
from apps.sales.models import SalesInvoice
from core.money import quantize_money

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.customers.models import Customer
    from apps.purchasing.models import Supplier
    from apps.tenants.models import Tenant

_ZERO = Decimal("0")


def invoice_outstanding(tenant: "Tenant", *, invoice: Any) -> Decimal:
    """Derived per-invoice outstanding: due_amount − Σ allocations."""
    if isinstance(invoice, SalesInvoice):
        allocated = (
            PaymentAllocation.objects.filter(tenant=tenant, sales_invoice=invoice).aggregate(
                total=Sum("amount")
            )["total"]
            or _ZERO
        )
    else:
        allocated = (
            PaymentAllocation.objects.filter(tenant=tenant, purchase_invoice=invoice).aggregate(
                total=Sum("amount")
            )["total"]
            or _ZERO
        )
    return quantize_money(max(invoice.due_amount - allocated, _ZERO))


def _credit_notes_total(tenant: "Tenant", customer: "Customer") -> Decimal:
    refunds_lists = SalesInvoice.objects.filter(
        tenant=tenant, customer=customer, doc_type=SalesInvoice.DocType.RETURN
    ).values_list("refunds", flat=True)
    total = _ZERO
    for refunds in refunds_lists:
        for refund in refunds:
            if refund.get("method") == "CREDIT_NOTE":
                total += Decimal(str(refund.get("amount", "0")))
    return total


def customer_outstanding_breakdown(tenant: "Tenant", customer: "Customer") -> dict[str, Decimal]:
    """The components of the canonical outstanding rule."""
    dues = (
        SalesInvoice.objects.filter(
            tenant=tenant,
            customer=customer,
            doc_type=SalesInvoice.DocType.SALE,
            status=SalesInvoice.Status.COMPLETED,
        ).aggregate(total=Sum("due_amount"))["total"]
        or _ZERO
    )
    credit_notes = _credit_notes_total(tenant, customer)
    receipts = (
        Payment.objects.filter(
            tenant=tenant, customer=customer, direction=Payment.Direction.RECEIPT
        ).aggregate(total=Sum("amount"))["total"]
        or _ZERO
    )
    outstanding = customer.opening_balance + dues - credit_notes - receipts
    return {
        "opening_balance": quantize_money(customer.opening_balance),
        "due_amount": quantize_money(dues),
        "credit_notes": quantize_money(credit_notes),
        "receipts": quantize_money(receipts),
        "outstanding": quantize_money(outstanding),
    }


def customer_outstanding(tenant: "Tenant", customer: "Customer") -> Decimal:
    """Canonical outstanding (dues − credit notes − receipts)."""
    return customer_outstanding_breakdown(tenant, customer)["outstanding"]


def supplier_payable(tenant: "Tenant", supplier: "Supplier") -> Decimal:
    """Payable = opening balance + confirmed purchase dues − payments made."""
    dues = (
        PurchaseInvoice.objects.filter(
            tenant=tenant, supplier=supplier, status=PurchaseInvoice.Status.CONFIRMED
        ).aggregate(total=Sum("due_amount"))["total"]
        or _ZERO
    )
    paid = (
        Payment.objects.filter(
            tenant=tenant, supplier=supplier, direction=Payment.Direction.PAYMENT
        ).aggregate(total=Sum("amount"))["total"]
        or _ZERO
    )
    return quantize_money(supplier.opening_balance + dues - paid)


def list_payments(
    tenant: "Tenant",
    user: "User",
    *,
    direction: str = "",
    method: str = "",
    customer_id: UUID | None = None,
    supplier_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> QuerySet[Payment]:
    qs = Payment.objects.filter(tenant=tenant).select_related(
        "branch", "customer", "supplier", "created_by"
    )
    if direction:
        qs = qs.filter(direction=direction)
    if method:
        qs = qs.filter(method=method)
    if customer_id:
        qs = qs.filter(customer_id=customer_id)
    if supplier_id:
        qs = qs.filter(supplier_id=supplier_id)
    if date_from:
        qs = qs.filter(business_date_ad__gte=date_from)
    if date_to:
        qs = qs.filter(business_date_ad__lte=date_to)
    return qs.order_by("-created_at")


class LedgerRow(NamedTuple):
    """One running-balance row for a party ledger."""

    date: date
    kind: str  # SALE | RECEIPT | CREDIT_NOTE | PURCHASE | PAYMENT | OPENING
    ref: str
    debit: Decimal
    credit: Decimal
    balance: Decimal


def customer_ledger(tenant: "Tenant", customer: "Customer") -> list[LedgerRow]:
    """Chronological running-balance khata for a customer.

    Debit = they owe more (sale), credit = they owe less (receipt,
    credit note). Starts from the opening balance.
    """
    events: list[tuple[Any, str, str, Decimal, Decimal]] = [
        (customer.created_at, "OPENING", "Opening balance", customer.opening_balance, _ZERO)
    ]
    sales = SalesInvoice.objects.filter(
        tenant=tenant,
        customer=customer,
        doc_type=SalesInvoice.DocType.SALE,
        status=SalesInvoice.Status.COMPLETED,
    ).exclude(due_amount=_ZERO)
    for invoice in sales:
        events.append(
            (invoice.created_at, "SALE", f"Bill {invoice.invoice_no}", invoice.due_amount, _ZERO)
        )
    returns = SalesInvoice.objects.filter(
        tenant=tenant, customer=customer, doc_type=SalesInvoice.DocType.RETURN
    )
    for invoice in returns:
        credit = sum(
            (
                Decimal(str(r["amount"]))
                for r in invoice.refunds
                if r.get("method") == "CREDIT_NOTE"
            ),
            _ZERO,
        )
        if credit > _ZERO:
            events.append(
                (invoice.created_at, "CREDIT_NOTE", f"Return {invoice.invoice_no}", _ZERO, credit)
            )
    receipts = Payment.objects.filter(
        tenant=tenant, customer=customer, direction=Payment.Direction.RECEIPT
    )
    for payment in receipts:
        events.append(
            (payment.created_at, "RECEIPT", f"{payment.method} receipt", _ZERO, payment.amount)
        )

    events.sort(key=lambda e: (e[0], e[1]))
    rows: list[LedgerRow] = []
    balance = _ZERO
    for created, kind, ref, debit, credit in events:
        balance = quantize_money(balance + debit - credit)
        rows.append(
            LedgerRow(
                date=created.date() if hasattr(created, "date") else created,
                kind=kind,
                ref=ref,
                debit=debit,
                credit=credit,
                balance=balance,
            )
        )
    return rows


def supplier_ledger(tenant: "Tenant", supplier: "Supplier") -> list[LedgerRow]:
    """Chronological running-balance khata for a supplier."""
    events: list[tuple[Any, str, str, Decimal, Decimal]] = [
        (supplier.created_at, "OPENING", "Opening balance", supplier.opening_balance, _ZERO)
    ]
    purchases = PurchaseInvoice.objects.filter(
        tenant=tenant, supplier=supplier, status=PurchaseInvoice.Status.CONFIRMED
    ).exclude(due_amount=_ZERO)
    for invoice in purchases:
        events.append(
            (
                invoice.created_at,
                "PURCHASE",
                f"Bill {invoice.invoice_no}",
                invoice.due_amount,
                _ZERO,
            )
        )
    payments = Payment.objects.filter(
        tenant=tenant, supplier=supplier, direction=Payment.Direction.PAYMENT
    )
    for payment in payments:
        events.append(
            (payment.created_at, "PAYMENT", f"{payment.method} payment", _ZERO, payment.amount)
        )

    events.sort(key=lambda e: (e[0], e[1]))
    rows: list[LedgerRow] = []
    balance = _ZERO
    for created, kind, ref, debit, credit in events:
        balance = quantize_money(balance + debit - credit)
        rows.append(
            LedgerRow(
                date=created.date() if hasattr(created, "date") else created,
                kind=kind,
                ref=ref,
                debit=debit,
                credit=credit,
                balance=balance,
            )
        )
    return rows


_AGING_BUCKETS = ((0, 30), (31, 60), (61, 90), (91, None))


def customer_aging(tenant: "Tenant") -> list[dict[str, Any]]:
    """Receivables aging per customer: outstanding bucketed by invoice age.

    Per-invoice outstanding (due − allocations) is bucketed by days since
    business_date_ad; unallocated money (advances + credit notes) reduces
    the OLDEST bucket first (documented rule).
    """
    today = timezone.localdate()
    customers: dict[Any, dict[str, Any]] = {}

    open_sales = SalesInvoice.objects.filter(
        tenant=tenant,
        doc_type=SalesInvoice.DocType.SALE,
        status=SalesInvoice.Status.COMPLETED,
        due_amount__gt=_ZERO,
    ).select_related("customer")
    for invoice in open_sales:
        entry = customers.setdefault(
            invoice.customer_id,
            {
                "customer": invoice.customer,
                "buckets": {label: _ZERO for label, _ in _bucket_labels()},
            },
        )
        days = (today - invoice.business_date_ad).days
        label = _bucket_label(days)
        outstanding = invoice_outstanding(tenant, invoice=invoice)
        entry["buckets"][label] += outstanding

    rows: list[dict[str, Any]] = []
    for entry in customers.values():
        customer = entry["customer"]
        buckets = entry["buckets"]
        gross = sum(buckets.values())
        unallocated = _unallocated_money(tenant, customer)
        for label, _range in _bucket_labels():  # oldest first
            reduction = min(unallocated, buckets[label])
            buckets[label] -= reduction
            unallocated -= reduction
        total = sum(buckets.values())
        if total > _ZERO:
            rows.append(
                {
                    "customer_id": str(customer.pk),
                    "customer_name": customer.name,
                    "buckets": {
                        label: str(quantize_money(amount)) for label, amount in buckets.items()
                    },
                    "total_outstanding": str(quantize_money(total)),
                    "unallocated": str(quantize_money(gross - total)),
                }
            )
    rows.sort(key=lambda r: r["customer_name"])
    return rows


def _bucket_labels() -> list[tuple[str, Any]]:
    return [("0-30", (0, 30)), ("31-60", (31, 60)), ("61-90", (61, 90)), ("90+", (91, None))]


def _bucket_label(days: int) -> str:
    for label, (low, high) in zip(["0-30", "31-60", "61-90", "90+"], _AGING_BUCKETS, strict=True):
        if days >= low and (high is None or days <= high):
            return label
    return "90+" if days > 90 else "0-30"


def _unallocated_money(tenant: "Tenant", customer: "Customer") -> Decimal:
    """Advances + credit notes not yet consumed by per-invoice outstanding."""
    breakdown = customer_outstanding_breakdown(tenant, customer)
    dues = breakdown["due_amount"]
    covered = dues - breakdown["outstanding"]  # credit notes + receipts total
    allocated = (
        PaymentAllocation.objects.filter(tenant=tenant, sales_invoice__customer=customer).aggregate(
            total=Sum("amount")
        )["total"]
        or _ZERO
    )
    return quantize_money(max(covered - allocated, _ZERO))
