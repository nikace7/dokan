"""Write-side SMS queue and receipt rules."""

from __future__ import annotations

import re
from collections.abc import Mapping
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import transaction

from apps.notifications.models import SmsLog
from apps.notifications.templates import render_sms_template
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.sales.models import SalesInvoice
    from apps.tenants.models import Tenant

_NEPAL_MOBILE = re.compile(r"9[678]\d{8}")


def normalize_nepal_phone(value: str | None) -> str:
    """Return a Nepal mobile as 977XXXXXXXXXX, rejecting non-mobile input."""
    compact = re.sub(r"[\s()-]", "", (value or "").strip())
    if compact.startswith("+"):
        compact = compact[1:]
    local = compact[3:] if compact.startswith("977") else compact
    if not _NEPAL_MOBILE.fullmatch(local):
        raise ServiceError("SMS_PHONE_INVALID", "A valid Nepali mobile number is required.")
    return f"977{local}"


def queue_sms(
    tenant: Tenant,
    *,
    to_phone: str | None,
    template: str,
    context: Mapping[str, str],
) -> SmsLog:
    """Persist QUEUED first, then dispatch only after the DB transaction commits."""
    row = SmsLog.objects.create(
        tenant=tenant,
        to_phone=normalize_nepal_phone(to_phone),
        template=template,
        body=render_sms_template(template, context),
    )

    def dispatch() -> None:
        from apps.notifications.tasks import send_sms

        send_sms.delay(str(tenant.pk), str(row.pk))

    transaction.on_commit(dispatch, robust=True)
    return row


def queue_receipt_sms(
    tenant: Tenant, *, invoice: SalesInvoice, to_phone: str | None = None
) -> SmsLog:
    """Queue a completed sale receipt, defaulting to the attached customer phone."""
    if (
        invoice.tenant_id != tenant.pk
        or invoice.doc_type != "SALE"
        or invoice.status != "COMPLETED"
        or invoice.invoice_no is None
    ):
        raise ServiceError(
            "SMS_RECEIPT_NOT_ALLOWED",
            "Only completed sale bills can send an SMS receipt.",
            409,
        )
    customer_phone = invoice.customer.phone if invoice.customer else None
    invoice_ref = (
        f"{invoice.branch.invoice_prefix}-{invoice.fiscal_year_bs}-{invoice.invoice_no:06d}"
    )
    return queue_sms(
        tenant,
        to_phone=to_phone if to_phone is not None else customer_phone,
        template="receipt",
        context={
            "shop_name": tenant.name,
            "invoice_no": invoice_ref,
            "total": _money(invoice.total),
            "paid_amount": _money(invoice.paid_amount),
            "due_amount": _money(invoice.due_amount),
        },
    )


def _money(value: Decimal | Any) -> str:
    return format(Decimal(value), ".2f")
