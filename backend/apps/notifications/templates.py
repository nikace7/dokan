"""Reviewable SMS templates; providers never receive ad-hoc caller text."""

from collections.abc import Mapping

from core.responses import ServiceError

_RECEIPT_FIELDS = ("shop_name", "invoice_no", "total", "paid_amount", "due_amount")
_SUPPORT_ACCESS_FIELDS = ("shop_name", "platform_user_name", "expires_at")


def render_sms_template(template: str, context: Mapping[str, str]) -> str:
    """Render one known template with strict context validation."""
    required = {
        "receipt": _RECEIPT_FIELDS,
        "support_access": _SUPPORT_ACCESS_FIELDS,
    }.get(template)
    if required is None:
        raise ServiceError("SMS_TEMPLATE_INVALID", "Unknown SMS template.")
    missing = [field for field in required if not context.get(field)]
    if missing:
        raise ServiceError("SMS_TEMPLATE_CONTEXT_INVALID", "SMS template context is incomplete.")
    if template == "support_access":
        return (
            f"{context['shop_name']}: Support access started by "
            f"{context['platform_user_name']} until {context['expires_at']}. "
            "End it from the Support Access page if unexpected."
        )
    return (
        f"{context['shop_name']}: Bill {context['invoice_no']} total NPR {context['total']}, "
        f"paid NPR {context['paid_amount']}, due NPR {context['due_amount']}. Thank you."
    )
