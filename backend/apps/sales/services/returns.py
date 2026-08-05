"""Returns — credit notes against completed sales (invariant 3).

A RETURN is its own document (never an edit of the original):

- ``doc_type=RETURN``, ``original_invoice_id`` set, **its own gapless
  number** from the RETURN series (core/numbering keys sequences on
  doc_type, so SALE and RETURN number independently per branch per fiscal
  year — both gapless, both IRD-auditable).
- Amounts are stored POSITIVE; the doc_type marks the direction. Reports
  subtract RETURN docs by type. VAT uses the same 13% rule on the
  VAT-applicable returned portion when the original was a VAT bill.
- Amount per line: ``original unit_price × qty − proportional line
  discount``. The bill-level discount portion comes back proportionally
  to the returned taxable share.
- Stock returns via SALE_RETURN at the original ``cost_at_sale`` (#1, #2).

Two sanctioned writes, documented:
- ``returned_qty`` on the ORIGINAL's line rows is the schema's running
  counter (docs/DATABASE_SCHEMA.md §8.3: "incremented by RETURN docs").
  It is the ONE allowed update on completed-invoice lines — financial
  fields are never touched. Validated and incremented under
  SELECT ... FOR UPDATE so concurrent returns can't over-return.
- Udharo credit is NOT applied by editing the original invoice. It is
  recorded as a ``CREDIT_NOTE`` entry in this return's ``refunds`` list;
  customer outstanding = dues − credit notes (computed by the selector in
  apps/customers/selectors.py).
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from apps.inventory.services import post_sale_return_movement
from apps.sales.models import SalesInvoice, SalesInvoiceItem
from apps.sales.services.create_sale import VAT_RATE, SaleResult
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.numbering import allocate_number
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_ZERO = Decimal("0")

#: Refund settlement methods for the refunds JSON list.
REFUND_METHODS = frozenset(
    {"CASH", "ESEWA", "KHALTI", "FONEPAY", "CARD", "BANK", "CREDIT_NOTE", "EXCHANGE_APPLIED"}
)


@dataclass(frozen=True)
class ReturnLineInput:
    """One returned line (variant object already tenant-scoped)."""

    variant: Any
    qty: Decimal


@dataclass(frozen=True)
class _ReturnLine:
    original_item: SalesInvoiceItem
    qty: Decimal
    gross: Decimal
    discount: Decimal
    credit: Decimal
    vat_applicable: bool


def _validate_return_lines(
    original: SalesInvoice,
    lines: list[ReturnLineInput],
) -> list[_ReturnLine]:
    """Validate quantities against remaining returnable, locking the lines."""
    original_items = {
        item.variant_id: item
        for item in SalesInvoiceItem.objects.select_for_update().filter(invoice=original)
    }
    resolved: list[_ReturnLine] = []
    for line in lines:
        qty = Decimal(line.qty)
        if qty <= _ZERO:
            raise ServiceError("QTY_INVALID", "Return quantity must be greater than zero.")
        item = original_items.get(line.variant.pk)
        if item is None:
            raise ServiceError(
                "RETURN_LINE_NOT_INVOICED",
                f"{line.variant.sku} is not on the original bill.",
            )
        remaining = item.qty - item.returned_qty
        if qty > remaining:
            raise ServiceError(
                "OVER_RETURN",
                f"Only {remaining} of {item.variant.sku} can still be returned.",
            )
        gross = quantize_money(item.unit_price * qty)
        discount = quantize_money(item.discount * qty / item.qty)
        resolved.append(
            _ReturnLine(
                original_item=item,
                qty=qty,
                gross=gross,
                discount=discount,
                credit=quantize_money(gross - discount),
                vat_applicable=bool(item.variant.item.is_vat_applicable),
            )
        )
    return resolved


def _compute_return_totals(
    tenant: "Tenant",
    *,
    original: SalesInvoice,
    resolved: list[_ReturnLine],
) -> dict[str, Decimal]:
    """Credit-note totals: proportional discounts + the documented VAT rule."""
    subtotal = quantize_money(sum(line.gross for line in resolved))
    line_discounts = quantize_money(sum(line.discount for line in resolved))

    # Bill-level discount portion comes back proportionally to the returned
    # share of the original taxable amount.
    original_line_discounts = sum(item.discount for item in original.items.all())
    bill_portion = original.discount_amount - original_line_discounts
    returned_taxable = subtotal - line_discounts
    bill_credit = _ZERO
    if bill_portion > _ZERO and original.taxable_amount > _ZERO:
        bill_credit = quantize_money(bill_portion * returned_taxable / original.taxable_amount)

    discount_amount = quantize_money(line_discounts + bill_credit)
    taxable_amount = quantize_money(subtotal - discount_amount)
    vat_amount = _ZERO
    if original.is_vat_bill and tenant.vat_registered:
        vat_base = sum(line.credit for line in resolved if line.vat_applicable)
        vat_amount = quantize_money(vat_base * VAT_RATE)
    total = quantize_money(taxable_amount + vat_amount)
    return {
        "subtotal": subtotal,
        "discount_amount": discount_amount,
        "taxable_amount": taxable_amount,
        "vat_amount": vat_amount,
        "total": total,
    }


def _validate_refunds(*, refunds: list[dict[str, Any]], total: Decimal) -> None:
    """Σ refunds must not exceed the credit amount."""
    refunded = _ZERO
    for refund in refunds:
        if refund["method"] not in REFUND_METHODS:
            raise ServiceError(
                "REFUND_METHOD_INVALID", f"Unknown refund method: {refund['method']}."
            )
        amount = quantize_money(refund["amount"])
        if amount <= _ZERO:
            raise ServiceError("REFUND_AMOUNT_INVALID", "Refund amounts must be positive.")
        refunded += amount
    if refunded > total:
        raise ServiceError("REFUND_EXCEEDS_CREDIT", "Refunds exceed the return's credit amount.")


def _apply_credit_note(
    tenant: "Tenant", *, original: SalesInvoice, refunds: list[dict[str, Any]]
) -> None:
    """A CREDIT_NOTE refund reduces the customer's outstanding dues.

    Bounded by the current outstanding (dues − prior credit notes).
    """
    credit_note_total = sum(
        (quantize_money(r["amount"]) for r in refunds if r["method"] == "CREDIT_NOTE"),
        _ZERO,
    )
    if credit_note_total <= _ZERO:
        return
    if original.customer is None:
        raise ServiceError(
            "CREDIT_NOTE_WITHOUT_CUSTOMER", "The original bill has no customer to credit."
        )
    from apps.customers.selectors import get_customer_outstanding

    outstanding = get_customer_outstanding(tenant, original.customer)
    if credit_note_total > outstanding:
        raise ServiceError(
            "CREDIT_NOTE_EXCEEDS_DUES",
            "The credit note exceeds the customer's outstanding dues.",
        )


def _create_return_invoice(
    tenant: "Tenant",
    *,
    original: SalesInvoice,
    lines: list[ReturnLineInput],
    reason: str,
    refunds: list[dict[str, Any]],
    idempotency_key: str,
    created_by: "User",
    business_date: date | None = None,
    exchange_group_id: Any = None,
) -> SalesInvoice:
    """Build and complete a RETURN document inside the caller's transaction."""
    if original.status != SalesInvoice.Status.COMPLETED:
        raise ServiceError(
            "RETURN_NOT_ALLOWED",
            "Only completed bills can be returned.",
            http_status=409,
        )
    if not reason.strip():
        raise ServiceError("REASON_REQUIRED", "A return reason is required.")
    if not lines:
        raise ServiceError("LINES_REQUIRED", "A return needs at least one line.")

    resolved = _validate_return_lines(original, lines)
    totals = _compute_return_totals(tenant, original=original, resolved=resolved)
    _validate_refunds(refunds=refunds, total=totals["total"])
    _apply_credit_note(tenant, original=original, refunds=refunds)

    date_ad = business_date or timezone.localdate()
    fy_bs = fiscal_year_bs(date_ad)
    invoice = SalesInvoice(
        tenant=tenant,
        branch=original.branch,
        customer=original.customer,
        rate_type=original.rate_type,
        doc_type=SalesInvoice.DocType.RETURN,
        original_invoice=original,
        exchange_group_id=exchange_group_id,
        status=SalesInvoice.Status.COMPLETED,
        is_vat_bill=original.is_vat_bill,
        idempotency_key=idempotency_key,
        created_by=created_by,
        subtotal=totals["subtotal"],
        discount_amount=totals["discount_amount"],
        # The schema has no dedicated return-reason column; the reason is
        # kept on the one free-text reason field (a returns-reason table is
        # a later refinement).
        discount_reason=reason,
        taxable_amount=totals["taxable_amount"],
        vat_amount=totals["vat_amount"],
        round_off=_ZERO,
        total=totals["total"],
        paid_amount=_ZERO,
        due_amount=_ZERO,
        refunds=[
            {"method": r["method"], "amount": str(quantize_money(r["amount"]))} for r in refunds
        ],
        datetime_ad=timezone.now(),
        business_date_ad=date_ad,
        business_date_bs=ad_to_bs(date_ad),
        fiscal_year_bs=fy_bs,
    )
    invoice.invoice_no = allocate_number(
        connection,
        tenant_id=tenant.pk,
        branch_id=original.branch_id,
        doc_type=SalesInvoice.DocType.RETURN,  # separate gapless series
        fiscal_year_bs=fy_bs,
        prefix=original.branch.invoice_prefix,
    )
    invoice.save()

    for line in resolved:
        line.original_item.returned_qty += line.qty
        line.original_item.save(update_fields=["returned_qty"])
        post_sale_return_movement(
            tenant,
            branch=original.branch,
            variant=line.original_item.variant,
            qty=line.qty,
            unit_cost=line.original_item.cost_at_sale,
            created_by=created_by,
            ref_type="sales_invoice",
            ref_id=invoice.pk,
            note=f"Return of {original.invoice_no}: {reason}",
            business_date=business_date,
        )
        SalesInvoiceItem.objects.create(
            tenant=tenant,
            invoice=invoice,
            variant=line.original_item.variant,
            qty=line.qty,
            rate_type=original.rate_type,
            unit_price=line.original_item.unit_price,
            discount=line.discount,
            line_total=line.credit,
            cost_at_sale=line.original_item.cost_at_sale,
        )

    # CBMS sync queue — explicit call, same transaction (never a signal).
    from apps.compliance.services import enqueue_for_sync

    enqueue_for_sync(tenant, invoice=invoice)
    return invoice


def create_return(
    tenant: "Tenant",
    *,
    original_invoice: SalesInvoice,
    lines: list[ReturnLineInput],
    reason: str,
    refunds: list[dict[str, Any]] | None = None,
    idempotency_key: str,
    created_by: "User",
    business_date: date | None = None,
) -> SaleResult:
    """Create a credit note (RETURN) in ONE transaction (idempotent)."""
    if not idempotency_key.strip():
        raise ServiceError("IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required.")
    try:
        with transaction.atomic():
            invoice = _create_return_invoice(
                tenant,
                original=original_invoice,
                lines=lines,
                reason=reason,
                refunds=refunds or [],
                idempotency_key=idempotency_key.strip(),
                created_by=created_by,
                business_date=business_date,
            )
            return SaleResult(invoice=invoice, replayed=False)
    except IntegrityError as exc:
        if "idempotency" in str(exc):
            original = SalesInvoice.objects.get(
                tenant=tenant, idempotency_key=idempotency_key.strip()
            )
            return SaleResult(invoice=original, replayed=True)
        raise
