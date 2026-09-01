"""Held bills — park, complete, and cancel working bills.

Rules (design §7.3 + task slice):
- A HELD invoice takes NO stock movement and consumes NO invoice number
  (``invoice_no`` stays NULL; the gapless series only advances at
  completion, so a discarded held bill never leaves a hole).
- Lines are priced at hold time; completion re-validates guardrails,
  re-snapshots costs, posts stock, allocates the number, and recomputes
  totals with the payments given at completion.
- Only HELD bills can change. COMPLETED is terminal (#3); CANCELLED is the
  same-day void state for held bills — a status, never a DELETE.
"""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.services import audit
from apps.sales.models import SalesInvoice, SalesInvoiceItem
from apps.sales.services.calculations import compute_totals, resolve_lines
from apps.sales.services.create_sale import (
    SaleLineInput,
    SaleResult,
    finalize_invoice,
)
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_ZERO = Decimal("0")


def _assert_held(invoice: SalesInvoice) -> None:
    """Only HELD bills may be completed or cancelled (#3)."""
    if invoice.status != SalesInvoice.Status.HELD:
        raise ServiceError(
            "INVOICE_NOT_EDITABLE",
            "Only held bills can be changed. Completed invoices are final.",
            http_status=409,
        )


def hold_bill(
    tenant: "Tenant",
    *,
    branch: Any,
    rate_type: Any,
    lines: list[SaleLineInput],
    customer: Any = None,
    is_vat_bill: bool = False,
    bill_discount: Decimal = _ZERO,
    round_off: Decimal = _ZERO,
    device_id: str | None = None,
    idempotency_key: str,
    created_by: "User",
    override_reason: str = "",
) -> SaleResult:
    """Park a bill as HELD: lines + display totals, no stock, no number."""
    if not idempotency_key.strip():
        raise ServiceError("IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required.")
    if not lines:
        raise ServiceError("LINES_REQUIRED", "A bill needs at least one line.")

    # Resolve prices for display now; the completion pipeline re-validates.
    resolved = resolve_lines(
        tenant,
        rate_type=rate_type,
        lines=lines,
        user=created_by,
        override_reason=override_reason,
    )
    totals = compute_totals(
        tenant,
        resolved=resolved,
        is_vat_bill=is_vat_bill,
        bill_discount=quantize_money(bill_discount),
        round_off=quantize_money(round_off),
    )
    try:
        with transaction.atomic():
            invoice = SalesInvoice(
                tenant=tenant,
                branch=branch,
                customer=customer,
                rate_type=rate_type,
                doc_type=SalesInvoice.DocType.SALE,
                status=SalesInvoice.Status.HELD,
                is_vat_bill=is_vat_bill,
                device_id=device_id,
                idempotency_key=idempotency_key.strip(),
                created_by=created_by,
                subtotal=totals["subtotal"],
                discount_amount=totals["discount_amount"],
                taxable_amount=totals["taxable_amount"],
                vat_amount=totals["vat_amount"],
                round_off=quantize_money(round_off),
                total=totals["total"],
                paid_amount=_ZERO,
                due_amount=_ZERO,
                datetime_ad=timezone.now(),
                business_date_ad=timezone.localdate(),
                business_date_bs=ad_to_bs(timezone.localdate()),
                fiscal_year_bs=fiscal_year_bs(timezone.localdate()),
            )
            invoice.save()
            SalesInvoiceItem.objects.bulk_create(
                [
                    SalesInvoiceItem(
                        tenant=tenant,
                        invoice=invoice,
                        variant=line.variant,
                        qty=line.qty,
                        rate_type=rate_type,
                        unit_price=line.unit_price,
                        discount=line.discount,
                        line_total=line.line_total,
                        cost_at_sale=line.cost_at_sale,
                    )
                    for line in resolved
                ]
            )
            return SaleResult(invoice=invoice, replayed=False)
    except IntegrityError as exc:
        if "idempotency" in str(exc):
            original = SalesInvoice.objects.get(
                tenant=tenant, idempotency_key=idempotency_key.strip()
            )
            return SaleResult(invoice=original, replayed=True)
        raise


def complete_held_bill(
    tenant: "Tenant",
    *,
    invoice: SalesInvoice,
    payments: list[dict[str, Any]],
    created_by: "User",
    override_reason: str = "",
    business_date: date | None = None,
    require_open_cash_session: bool = False,
) -> SalesInvoice:
    """Complete a held bill: stock, number, totals — one transaction."""
    _assert_held(invoice)
    stored_lines = [
        SaleLineInput(
            variant=item.variant,
            qty=item.qty,
            unit_price=item.unit_price,  # explicit: no re-resolution
            discount=item.discount,
        )
        for item in invoice.items.all()
    ]
    if not stored_lines:
        raise ServiceError("LINES_REQUIRED", "A held bill has no lines to complete.")
    bill_discount = invoice.discount_amount - sum(line.discount for line in stored_lines)
    with transaction.atomic():
        finalize_invoice(
            tenant,
            invoice=invoice,
            lines=stored_lines,
            payments=payments,
            bill_discount=bill_discount,
            round_off=invoice.round_off,
            created_by=created_by,
            override_reason=override_reason,
            business_date=business_date,
            require_open_cash_session=require_open_cash_session,
        )
    return invoice


def cancel_held_bill(tenant: "Tenant", *, invoice: SalesInvoice) -> SalesInvoice:
    """Void a held bill — a status change, never a DELETE."""
    _assert_held(invoice)
    with transaction.atomic():
        invoice.status = SalesInvoice.Status.CANCELLED
        invoice.save(update_fields=["status", "updated_at"])
        audit(
            tenant,
            actor=invoice.created_by,
            action="sale.cancel_held",
            target_type="sales_invoice",
            target_id=invoice,
            before={"status": SalesInvoice.Status.HELD},
            after={"status": SalesInvoice.Status.CANCELLED},
        )
    return invoice
