"""Request-scoped context for explicit service-layer audit writes."""

from collections.abc import Callable
from contextvars import ContextVar
from typing import Final

from django.http import HttpRequest, HttpResponse

_AUDIT_REQUEST: Final[ContextVar[HttpRequest | None]] = ContextVar(
    "audit_request",
    default=None,
)


def get_audit_request() -> HttpRequest | None:
    """Return the request active in this execution context, if any."""
    return _AUDIT_REQUEST.get()


class AuditContextMiddleware:
    """Expose the current request to explicit ``audit(...)`` calls."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        token = _AUDIT_REQUEST.set(request)
        try:
            return self.get_response(request)
        finally:
            _AUDIT_REQUEST.reset(token)
