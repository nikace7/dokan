"""Sale completion pipeline — the POS billing core. ONE transaction per sale.

Order of operations (invariant map, ARCHITECTURE §6):
1. Resolve/guard prices (pricing app; #10 cost never leaks).
2. Compute totals. **VAT rule (documented, simple):** VAT is charged
   VAT-EXCLUSIVE at 13% on the discounted line total of items flagged
   ``is_vat_applicable``, only when the bill is marked ``is_vat_bill`` AND
   the tenant is VAT-registered. Otherwise ``vat_amount`` is zero.
3. Credit check: due > 0 requires a customer; a set ``credit_limit`` caps
   (existing COMPLETED dues + this due) → CREDIT_LIMIT_EXCEEDED.
4. Stock: one SALE movement per line via the inventory ledger inside THIS
   transaction (#1); insufficient stock rolls the whole sale back.
5. Numbering: gapless per branch per fiscal_year_bs via the row-locked
   number_sequence (#IRD; a rollback releases the number).
6. cost_at_sale snapshotted per line (#2) — never recomputed later.

Idempotency (#8): ``idempotency_key`` is mandatory and unique per tenant; a
replay returns the original invoice with ``replayed=True`` (the view
answers 200, not 201). The same key with a DIFFERENT bill is refused: handing
back the old invoice would let the new items leave the shop unbilled.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from functools import partial
from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from apps.inventory.services import post_sale_movement
from apps.sales.models import SalesInvoice, SalesInvoiceItem
from apps.sales.services.calculations import PAYMENT_METHODS as PAYMENT_METHODS
from apps.sales.services.calculations import VAT_RATE as VAT_RATE
from apps.sales.services.calculations import (
    ResolvedLine,
    check_credit,
    compute_totals,
    resolve_lines,
    split_payments,
)
from apps.sales.services.calculations import SaleLineInput as SaleLineInput
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.numbering import allocate_number
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.pricing.models import RateType
    from apps.tenants.models import Tenant

_ZERO = Decimal("0")


@dataclass(frozen=True)
class SaleResult:
    invoice: SalesInvoice
    replayed: bool


def _tender_rows(payments: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [
        {"method": payment["method"], "amount": str(quantize_money(payment["amount"]))}
        for payment in payments
    ]


def _replay(
    invoice: SalesInvoice,
    *,
    branch: Any,
    rate_type: "RateType",
    customer: Any,
    lines: list[SaleLineInput],
    payments: list[dict[str, Any]],
    is_vat_bill: bool,
    bill_discount: Decimal,
    round_off: Decimal,
) -> SaleResult:
    """Return the original invoice, but only for the bill that created it."""
    # Lines without an explicit price were priced by the server, so a later
    # price change must not make an honest retry look like a different bill.
    priced = all(line.unit_price is not None for line in lines)
    requested = Counter(
        (
            line.variant.pk,
            Decimal(line.qty),
            quantize_money(line.discount),
            quantize_money(line.unit_price) if priced and line.unit_price is not None else None,
        )
        for line in lines
    )
    stored = Counter(
        (item.variant_id, item.qty, item.discount, item.unit_price if priced else None)
        for item in invoice.items.all()
    )
    line_discounts = sum((quantize_money(line.discount) for line in lines), _ZERO)
    is_same_bill = (
        requested == stored
        and invoice.branch_id == branch.pk
        and invoice.rate_type_id == rate_type.pk
        and invoice.customer_id == (customer.pk if customer else None)
        and invoice.is_vat_bill == is_vat_bill
        and invoice.discount_amount == line_discounts + quantize_money(bill_discount)
        and invoice.round_off == quantize_money(round_off)
        and invoice.tenders == _tender_rows(payments)
    )
    if not is_same_bill:
        raise ServiceError(
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key belongs to a different bill.",
            http_status=409,
        )
    return SaleResult(invoice=invoice, replayed=True)


def finalize_invoice(
    tenant: "Tenant",
    *,
    invoice: SalesInvoice,
    lines: list[SaleLineInput],
    payments: list[dict[str, Any]],
    bill_discount: Decimal,
    round_off: Decimal,
    created_by: "User",
    override_reason: str,
    business_date: date | None = None,
    applied_credit: Decimal = _ZERO,
    require_open_cash_session: bool = False,
) -> list[ResolvedLine]:
    """Run the completion pipeline for an invoice object (new or held).

    MUST be called inside transaction.atomic(). Fills totals, status,
    business dates, invoice number; posts stock; writes line rows (stored
    lines on a held bill are replaced first).

    ``applied_credit`` (exchanges only): a return credit consumed by this
    sale. It counts toward paid_amount BEFORE the tender split, so the
    udharo check runs on the NET due, and paid_amount + due_amount still
    equals total.
    """
    if require_open_cash_session:
        from apps.payments.services import require_open_session

        require_open_session(tenant, invoice.branch)
    resolved = resolve_lines(
        tenant,
        rate_type=invoice.rate_type,
        lines=lines,
        user=created_by,
        override_reason=override_reason,
    )
    totals = compute_totals(
        tenant,
        resolved=resolved,
        is_vat_bill=invoice.is_vat_bill,
        bill_discount=quantize_money(bill_discount),
        round_off=quantize_money(round_off),
    )
    credit_applied = min(quantize_money(applied_credit), totals["total"])
    paid, due = split_payments(total=totals["total"] - credit_applied, payments=payments)
    check_credit(tenant, customer=invoice.customer, due=due)

    # Stock (#1) — inside this transaction; failure rolls everything back.
    for line in resolved:
        post_sale_movement(
            tenant,
            branch=invoice.branch,
            variant=line.variant,
            qty=line.qty,
            created_by=created_by,
            ref_type="sales_invoice",
            ref_id=invoice.pk,
            business_date=business_date,
        )

    # Gapless number + denormalized business dates (#9).
    date_ad = business_date or timezone.localdate()
    fy_bs = fiscal_year_bs(date_ad)
    invoice.invoice_no = allocate_number(
        connection,
        tenant_id=tenant.pk,
        branch_id=invoice.branch_id,
        doc_type=SalesInvoice.DocType.SALE,
        fiscal_year_bs=fy_bs,
        prefix=invoice.branch.invoice_prefix,
    )
    invoice.datetime_ad = timezone.now()
    invoice.business_date_ad = date_ad
    invoice.business_date_bs = ad_to_bs(date_ad)
    invoice.fiscal_year_bs = fy_bs
    invoice.tenders = _tender_rows(payments)
    invoice.subtotal = totals["subtotal"]
    invoice.discount_amount = totals["discount_amount"]
    invoice.taxable_amount = totals["taxable_amount"]
    invoice.vat_amount = totals["vat_amount"]
    invoice.round_off = quantize_money(round_off)
    invoice.total = totals["total"]
    invoice.paid_amount = quantize_money(paid + credit_applied)
    invoice.due_amount = due
    invoice.status = SalesInvoice.Status.COMPLETED
    invoice.save()

    invoice.items.all().delete()  # held-bill working rows are replaceable
    SalesInvoiceItem.objects.bulk_create(
        [
            SalesInvoiceItem(
                tenant=tenant,
                invoice=invoice,
                variant=line.variant,
                qty=line.qty,
                rate_type=invoice.rate_type,
                unit_price=line.unit_price,
                discount=line.discount,
                line_total=line.line_total,
                cost_at_sale=line.cost_at_sale,
            )
            for line in resolved
        ]
    )

    # CBMS sync queue — explicit call, same transaction (never a signal).
    from apps.compliance.services import enqueue_for_sync

    enqueue_for_sync(tenant, invoice=invoice)
    return resolved


def create_sale(
    tenant: "Tenant",
    *,
    branch: Any,
    rate_type: "RateType",
    lines: list[SaleLineInput],
    payments: list[dict[str, Any]],
    customer: Any = None,
    is_vat_bill: bool = False,
    bill_discount: Decimal = _ZERO,
    round_off: Decimal = _ZERO,
    device_id: str | None = None,
    idempotency_key: str,
    created_by: "User",
    override_reason: str = "",
    business_date: date | None = None,
    require_open_cash_session: bool = False,
) -> SaleResult:
    """Create and complete a sale in ONE transaction (idempotent)."""
    if not idempotency_key.strip():
        raise ServiceError("IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required.")
    if not lines:
        raise ServiceError("LINES_REQUIRED", "A bill needs at least one line.")
    key = idempotency_key.strip()
    replay = partial(
        _replay,
        branch=branch,
        rate_type=rate_type,
        customer=customer,
        lines=lines,
        payments=payments,
        is_vat_bill=is_vat_bill,
        bill_discount=bill_discount,
        round_off=round_off,
    )
    if require_open_cash_session:
        existing = SalesInvoice.objects.filter(tenant=tenant, idempotency_key=key).first()
        if existing is not None:
            return replay(existing)

    try:
        with transaction.atomic():
            invoice = SalesInvoice(
                tenant=tenant,
                branch=branch,
                customer=customer,
                rate_type=rate_type,
                doc_type=SalesInvoice.DocType.SALE,
                status=SalesInvoice.Status.HELD,  # becomes COMPLETED in finalize
                is_vat_bill=is_vat_bill,
                device_id=device_id,
                idempotency_key=key,
                created_by=created_by,
                subtotal=_ZERO,
                taxable_amount=_ZERO,
                total=_ZERO,
                paid_amount=_ZERO,
                due_amount=_ZERO,
                datetime_ad=timezone.now(),
                business_date_ad=timezone.localdate(),
                business_date_bs=ad_to_bs(timezone.localdate()),
                fiscal_year_bs=fiscal_year_bs(timezone.localdate()),
            )
            finalize_invoice(
                tenant,
                invoice=invoice,
                lines=lines,
                payments=payments,
                bill_discount=bill_discount,
                round_off=round_off,
                created_by=created_by,
                override_reason=override_reason,
                business_date=business_date,
                require_open_cash_session=require_open_cash_session,
            )
            return SaleResult(invoice=invoice, replayed=False)
    except IntegrityError as exc:
        if "idempotency" in str(exc):
            return replay(SalesInvoice.objects.get(tenant=tenant, idempotency_key=key))
        raise
