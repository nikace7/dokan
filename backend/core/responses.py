"""API envelope helpers — one shape for every endpoint (design §8.4).

Success: ``{"data": ..., "meta": {...}?, "error": null}``
Error:   ``{"data": null, "error": {"code": ..., "message": ...}}``
"""

from typing import Any

from rest_framework import status
from rest_framework.response import Response

from core.error_codes import canonical_error_code


def not_found_code(label: str) -> str:
    """Convert a human label into a stable machine-readable NOT_FOUND code."""
    return f"{canonical_error_code(label)}_NOT_FOUND"


def get_or_404(tenant: Any, model: Any, pk: Any, what: str) -> Any:
    """Fetch a tenant's row, or raise the standard not-found ServiceError."""
    instance = model.objects.filter(tenant=tenant, pk=pk).first()
    if instance is None:
        raise ServiceError(not_found_code(what), f"{what} not found.", http_status=404)
    return instance


def ok(data: Any, http_status: int = status.HTTP_200_OK) -> Response:
    """Success envelope."""
    return Response({"data": data, "error": None}, status=http_status)


def error(
    http_status: int,
    code: str,
    message: str,
    *,
    field: str | None = None,
    details: dict[str, Any] | None = None,
) -> Response:
    """Error envelope with a machine-readable code."""
    payload: dict[str, Any] = {"code": code, "message": message}
    if field is not None:
        payload["field"] = field
    if details is not None:
        payload["details"] = details
    return Response({"data": None, "error": payload}, status=http_status)


class ServiceError(Exception):
    """Business-rule failure with a machine-readable code for the envelope.

    Services raise these; views convert them with :func:`error`. Validation
    messages must never disclose cost prices to users without
    ``pricing.view_cost`` (ARCHITECTURE §6 invariant 10).
    """

    def __init__(
        self, code: str, message: str, http_status: int = status.HTTP_400_BAD_REQUEST
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
