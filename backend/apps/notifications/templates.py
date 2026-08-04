"""Reviewable SMS templates; providers never receive ad-hoc caller text."""

from collections.abc import Mapping

from core.responses import ServiceError

_RECEIPT_FIELDS = ("shop_name", "invoice_no", "total", "paid_amount", "due_amount")


def render_sms_template(template: str, context: Mapping[str, str]) -> str:
    """Render one known template with strict context validation."""
    if template != "receipt":
        raise ServiceError("SMS_TEMPLATE_INVALID", "Unknown SMS template.")
    missing = [field for field in _RECEIPT_FIELDS if not context.get(field)]
    if missing:
        raise ServiceError("SMS_TEMPLATE_CONTEXT_INVALID", "SMS template context is incomplete.")
    return (
        f"{context['shop_name']}: Bill {context['invoice_no']} total NPR {context['total']}, "
        f"paid NPR {context['paid_amount']}, due NPR {context['due_amount']}. Thank you."
    )
