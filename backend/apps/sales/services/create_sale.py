"""Sale completion pipeline — the POS billing core. ONE transaction per sale.

Order of operations (invariant map, AGENTS.md):
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
answers 200, not 201).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Final

from django.db import IntegrityError, connection, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.inventory.services import post_sale_movement
from apps.pricing.services import assert_price_within_bounds, resolve_price
from apps.sales.models import SalesInvoice, SalesInvoiceItem
from apps.tenants.services import require_plan_feature
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.numbering import allocate_number
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.catalog.models import ItemVariant
    from apps.pricing.models import RateType
    from apps.tenants.models import Tenant

#: Nepal VAT rate. See the VAT rule in the module docstring.
VAT_RATE: Final = Decimal("0.13")

#: Tender methods (docs/DATABASE_SCHEMA.md §8.4). CREDIT means udharo — it
#: is not part of paid_amount; it is exactly the due. QR is a wallet/QR
#: scan tender: cash-equivalent (counts toward paid) but NOT physical cash,
#: so — like ESEWA/KHALTI/FONEPAY — it never enters cash-session expected
#: cash.
PAYMENT_METHODS = frozenset(
    {"CASH", "ESEWA", "KHALTI", "FONEPAY", "QR", "CARD", "BANK", "CREDIT", "POINTS"}
)

_ZERO = Decimal("0")


@dataclass(frozen=True)
class SaleLineInput:
    """One incoming bill line (variant object already tenant-scoped)."""

    variant: "ItemVariant"
    qty: Decimal
    unit_price: Decimal | None  # None → resolve via the rate type
    discount: Decimal


@dataclass(frozen=True)
class SaleResult:
    invoice: SalesInvoice
    replayed: bool


@dataclass(frozen=True)
class _ResolvedLine:
    variant: "ItemVariant"
    qty: Decimal
    unit_price: Decimal
    discount: Decimal
    gross: Decimal
    line_total: Decimal
    cost_at_sale: Decimal
    vat_applicable: bool


def _resolve_lines(
    tenant: "Tenant",
    *,
    rate_type: "RateType",
    lines: list[SaleLineInput],
    user: "User",
    override_reason: str,
) -> list[_ResolvedLine]:
    """Resolve every line's price and validate the guardrails."""
    resolved: list[_ResolvedLine] = []
    for line in lines:
        qty = Decimal(line.qty)
        if qty <= _ZERO:
            raise ServiceError("QTY_INVALID", "Line quantity must be greater than zero.")
        if line.unit_price is None:
            unit_price = resolve_price(
                tenant, variant=line.variant, rate_type=rate_type, user=user
            ).price
        else:
            unit_price = quantize_money(line.unit_price)
            assert_price_within_bounds(
                tenant,
                variant=line.variant,
                price=unit_price,
                user=user,
                reason=override_reason,
            )
        discount = quantize_money(line.discount)
        gross = quantize_money(qty * unit_price)
        if discount < _ZERO or discount > gross:
            raise ServiceError(
                "DISCOUNT_INVALID", "Line discount must be between zero and the line amount."
            )
        resolved.append(
            _ResolvedLine(
                variant=line.variant,
                qty=qty,
                unit_price=unit_price,
                discount=discount,
                gross=gross,
                line_total=quantize_money(gross - discount),
                cost_at_sale=quantize_money(line.variant.avg_cost),  # SNAPSHOT (#2)
                vat_applicable=bool(line.variant.item.is_vat_applicable),
            )
        )
    return resolved


def _compute_totals(
    tenant: "Tenant",
    *,
    resolved: list[_ResolvedLine],
    is_vat_bill: bool,
    bill_discount: Decimal,
    round_off: Decimal,
) -> dict[str, Decimal]:
    """Invoice totals per the documented VAT rule."""
    if is_vat_bill:
        require_plan_feature(tenant, "vat_module")
    subtotal = quantize_money(sum(line.gross for line in resolved))
    discount_amount = quantize_money(sum(line.discount for line in resolved) + bill_discount)
    if bill_discount < _ZERO or discount_amount > subtotal:
        raise ServiceError(
            "DISCOUNT_INVALID", "Bill discount must be between zero and the subtotal."
        )
    taxable_amount = quantize_money(subtotal - discount_amount)
    vat_amount = _ZERO
    if is_vat_bill and tenant.vat_registered:
        vat_base = sum(line.line_total for line in resolved if line.vat_applicable)
        vat_amount = quantize_money(vat_base * VAT_RATE)
    total = quantize_money(taxable_amount + vat_amount + quantize_money(round_off))
    return {
        "subtotal": subtotal,
        "discount_amount": discount_amount,
        "taxable_amount": taxable_amount,
        "vat_amount": vat_amount,
        "total": total,
    }


def _split_payments(*, total: Decimal, payments: list[dict[str, Any]]) -> tuple[Decimal, Decimal]:
    """Return (paid_amount, due_amount). CREDIT is not paid — it is the due.

    Consistency rule: when a CREDIT tender is declared, its amount must
    equal the computed due exactly (total − other tenders). The tenders
    JSON feeds cash-session reconciliation; a CREDIT tender that disagrees
    with due_amount would split the same udharo into two different truths.
    Implicit udharo (due without a CREDIT tender) stays allowed.
    """
    paid = _ZERO
    credit = _ZERO
    for payment in payments:
        if payment["method"] not in PAYMENT_METHODS:
            raise ServiceError(
                "PAYMENT_METHOD_INVALID", f"Unknown payment method: {payment['method']}."
            )
        amount = quantize_money(payment["amount"])
        if amount <= _ZERO:
            raise ServiceError("PAYMENT_AMOUNT_INVALID", "Payment amounts must be positive.")
        if payment["method"] == "CREDIT":
            credit += amount
        else:
            paid += amount
    paid = quantize_money(paid)
    if paid > total:
        raise ServiceError("OVERPAYMENT", "Payments exceed the bill total.")
    due = quantize_money(total - paid)
    if credit > _ZERO and credit != due:
        raise ServiceError(
            "CREDIT_TENDER_MISMATCH",
            "The credit tender amount must equal the remaining due.",
        )
    return paid, due


def _check_credit(tenant: "Tenant", *, customer: Any, due: Decimal) -> None:
    """Udharo rules: due requires a customer; credit_limit caps total dues."""
    if due <= _ZERO:
        return
    if customer is None:
        raise ServiceError(
            "UDHARO_REQUIRES_CUSTOMER", "A credit (udharo) sale requires a customer."
        )
    if customer.credit_limit is None:
        return
    existing_dues = (
        SalesInvoice.objects.filter(
            tenant=tenant, customer=customer, status=SalesInvoice.Status.COMPLETED
        ).aggregate(total=Sum("due_amount"))["total"]
        or _ZERO
    )
    if existing_dues + due > customer.credit_limit:
        raise ServiceError(
            "CREDIT_LIMIT_EXCEEDED", "This sale would exceed the customer's credit limit."
        )


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
) -> list[_ResolvedLine]:
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
    resolved = _resolve_lines(
        tenant,
        rate_type=invoice.rate_type,
        lines=lines,
        user=created_by,
        override_reason=override_reason,
    )
    totals = _compute_totals(
        tenant,
        resolved=resolved,
        is_vat_bill=invoice.is_vat_bill,
        bill_discount=quantize_money(bill_discount),
        round_off=quantize_money(round_off),
    )
    credit_applied = min(quantize_money(applied_credit), totals["total"])
    paid, due = _split_payments(total=totals["total"] - credit_applied, payments=payments)
    _check_credit(tenant, customer=invoice.customer, due=due)

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
    invoice.tenders = [
        {"method": payment["method"], "amount": str(quantize_money(payment["amount"]))}
        for payment in payments
    ]
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
    if require_open_cash_session:
        existing = SalesInvoice.objects.filter(tenant=tenant, idempotency_key=key).first()
        if existing is not None:
            return SaleResult(invoice=existing, replayed=True)

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
            original = SalesInvoice.objects.get(tenant=tenant, idempotency_key=key)
            return SaleResult(invoice=original, replayed=True)
        raise
