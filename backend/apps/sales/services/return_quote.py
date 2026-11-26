"""What a return or an exchange would come to, before anyone records it.

The counter shows these figures, so they come from the very functions that
record the return and the sale — never from a second copy of the rules.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING

from django.db import transaction

from apps.sales.models import SalesInvoice
from apps.sales.services.calculations import SaleLineInput, compute_totals, resolve_lines
from apps.sales.services.returns import (
    ReturnLineInput,
    _compute_return_totals,
    _validate_return_lines,
)
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_ZERO = Decimal("0.00")


@dataclass(frozen=True)
class ReturnQuote:
    return_total: Decimal
    new_total: Decimal
    to_collect: Decimal
    to_refund: Decimal
    max_credit_note: Decimal


def _max_credit_note(tenant: "Tenant", original: SalesInvoice, to_refund: Decimal) -> Decimal:
    if original.customer is None:
        return _ZERO
    from apps.customers.selectors import get_customer_outstanding

    outstanding = get_customer_outstanding(tenant, original.customer)
    return max(_ZERO, min(outstanding, to_refund))


def quote_return(
    tenant: "Tenant",
    *,
    original: SalesInvoice,
    returned_lines: list[ReturnLineInput],
    new_lines: list[SaleLineInput],
    user: "User",
) -> ReturnQuote:
    """Price a return (or, with ``new_lines``, an exchange) without saving it."""
    if (
        original.doc_type != SalesInvoice.DocType.SALE
        or original.status != SalesInvoice.Status.COMPLETED
    ):
        raise ServiceError(
            "RETURN_NOT_ALLOWED", "Only completed sale bills can be returned.", http_status=409
        )
    with transaction.atomic():  # the line validation locks the bill's rows
        resolved = _validate_return_lines(original, returned_lines)
        return_total = _compute_return_totals(tenant, original=original, resolved=resolved)["total"]
    new_total = _ZERO
    if new_lines:
        new_total = compute_totals(
            tenant,
            resolved=resolve_lines(
                tenant,
                rate_type=original.rate_type,
                lines=new_lines,
                user=user,
                override_reason="",
            ),
            is_vat_bill=original.is_vat_bill,
            bill_discount=_ZERO,
            round_off=_ZERO,
        )["total"]
    to_refund = max(_ZERO, return_total - new_total)
    return ReturnQuote(
        return_total=return_total,
        new_total=new_total,
        to_collect=max(_ZERO, new_total - return_total),
        to_refund=to_refund,
        max_credit_note=_max_credit_note(tenant, original, to_refund),
    )
