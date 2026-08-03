"""Exchange — return + sale as ONE atomic operation (design §1.2).

"One screen, not two transactions": a single exchange_group_id links a
RETURN document (the items coming back) and a SALE document (the items
going out), both carrying ``original_invoice_id``. Everything — both
documents, both directions of stock movement, both numbering series —
commits or rolls back together.

Settlement (documented): the return credit is consumed by the new sale
first (``applied_credit`` in finalize_invoice, so the udharo check runs
on the NET due). If the credit exceeds the new sale's total, the excess
is refunded and recorded on the return's refunds list as CASH. The
return's refunds list records EXCHANGE_APPLIED for the consumed amount.

Idempotency: the exchange key is stored on the SALE doc; the RETURN doc
carries ``<key>:return`` (unique constraint is per key). A replay looks
up both by key and returns them with ``replayed=True``.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.sales.models import SalesInvoice
from apps.sales.services.create_sale import (
    SaleLineInput,
    finalize_invoice,
)
from apps.sales.services.returns import ReturnLineInput, _create_return_invoice
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_ZERO = Decimal("0")


@dataclass(frozen=True)
class ExchangeResult:
    return_invoice: SalesInvoice
    sale_invoice: SalesInvoice
    refund_amount: Decimal
    replayed: bool


def create_exchange(
    tenant: "Tenant",
    *,
    original_invoice: SalesInvoice,
    returned_lines: list[ReturnLineInput],
    new_lines: list[SaleLineInput],
    payments: list[dict[str, Any]],
    reason: str,
    idempotency_key: str,
    created_by: "User",
    override_reason: str = "",
    business_date: date | None = None,
    require_open_cash_session: bool = False,
) -> ExchangeResult:
    """Swap items against a completed bill — ONE transaction, two documents."""
    key = idempotency_key.strip()
    if not key:
        raise ServiceError("IDEMPOTENCY_KEY_REQUIRED", "The Idempotency-Key header is required.")
    if not new_lines:
        raise ServiceError("LINES_REQUIRED", "An exchange needs at least one new line.")
    if require_open_cash_session:
        existing_sale = SalesInvoice.objects.filter(tenant=tenant, idempotency_key=key).first()
        if existing_sale is not None:
            return ExchangeResult(
                return_invoice=SalesInvoice.objects.get(
                    tenant=tenant, idempotency_key=f"{key}:return"
                ),
                sale_invoice=existing_sale,
                refund_amount=_ZERO,
                replayed=True,
            )

    group_id = uuid4()
    try:
        with transaction.atomic():
            return_invoice = _create_return_invoice(
                tenant,
                original=original_invoice,
                lines=returned_lines,
                reason=reason,
                refunds=[],
                idempotency_key=f"{key}:return",
                created_by=created_by,
                business_date=business_date,
                exchange_group_id=group_id,
            )
            credit = return_invoice.total

            sale_invoice = SalesInvoice(
                tenant=tenant,
                branch=original_invoice.branch,
                customer=original_invoice.customer,
                rate_type=original_invoice.rate_type,
                doc_type=SalesInvoice.DocType.SALE,
                original_invoice=original_invoice,
                exchange_group_id=group_id,
                status=SalesInvoice.Status.HELD,  # becomes COMPLETED in finalize
                is_vat_bill=original_invoice.is_vat_bill,
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
                invoice=sale_invoice,
                lines=new_lines,
                payments=payments,
                bill_discount=_ZERO,
                round_off=_ZERO,
                created_by=created_by,
                override_reason=override_reason,
                business_date=business_date,
                applied_credit=credit,
                require_open_cash_session=require_open_cash_session,
            )

            # Settlement record on the return doc — written inside the same
            # transaction, before commit, so it is part of its creation.
            credit_applied = min(credit, sale_invoice.total)
            refund_amount = quantize_money(credit - credit_applied)
            refunds: list[dict[str, str]] = [
                {"method": "EXCHANGE_APPLIED", "amount": str(credit_applied)}
            ]
            if refund_amount > _ZERO:
                refunds.append({"method": "CASH", "amount": str(refund_amount)})
            return_invoice.refunds = refunds
            return_invoice.save(update_fields=["refunds"])

            return ExchangeResult(
                return_invoice=return_invoice,
                sale_invoice=sale_invoice,
                refund_amount=refund_amount,
                replayed=False,
            )
    except IntegrityError as exc:
        if "idempotency" in str(exc):
            sale_invoice = SalesInvoice.objects.get(tenant=tenant, idempotency_key=key)
            return_invoice = SalesInvoice.objects.get(
                tenant=tenant, idempotency_key=f"{key}:return"
            )
            return ExchangeResult(
                return_invoice=return_invoice,
                sale_invoice=sale_invoice,
                refund_amount=_ZERO,
                replayed=True,
            )
        raise
