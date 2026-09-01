"""DRF exception handler — every error response uses the API envelope.

Envelope (docs/SYSTEM_DESIGN.md §8.4):
``{"data": null, "error": {"code": "...", "message": "...", "field": ..., "details": ...}}``
A machine-readable ``code`` always, because the UI reacts differently to
``PRICE_BELOW_MINIMUM`` vs ``CREDIT_LIMIT_EXCEEDED``.
"""

from typing import Any

from rest_framework.views import exception_handler

from core.error_codes import canonical_error_code


def _code_for(exc: Any) -> str:
    """Derive a machine-readable code from the exception."""
    if hasattr(exc, "get_codes"):
        codes = exc.get_codes()
        if isinstance(codes, str):
            return canonical_error_code(codes)
        return "VALIDATION_ERROR"
    return canonical_error_code(type(exc).__name__)


def _message_for(exc: Any, data: Any) -> str:
    detail = getattr(exc, "detail", None)
    if isinstance(detail, str):
        return detail
    return str(data)


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Any:
    """Wrap DRF's default error payloads in the project envelope."""
    response = exception_handler(exc, context)
    if response is None:
        return None
    response.data = {
        "data": None,
        "error": {
            "code": _code_for(exc),
            "message": _message_for(exc, response.data),
            "field": None,
            "details": {},
        },
    }
    return response
