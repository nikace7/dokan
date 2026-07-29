"""API envelope helpers — one shape for every endpoint (design §8.4).

Success: ``{"data": ..., "meta": {...}?, "error": null}``
Error:   ``{"data": null, "error": {"code": ..., "message": ...}}``
"""

from typing import Any

from rest_framework import status
from rest_framework.response import Response


def ok(data: Any, http_status: int = status.HTTP_200_OK) -> Response:
    """Success envelope."""
    return Response({"data": data, "error": None}, status=http_status)


def error(http_status: int, code: str, message: str) -> Response:
    """Error envelope with a machine-readable code."""
    return Response({"data": None, "error": {"code": code, "message": message}}, status=http_status)


class ServiceError(Exception):
    """Business-rule failure with a machine-readable code for the envelope.

    Services raise these; views convert them with :func:`error`. Validation
    messages must never disclose cost prices to users without
    ``pricing.view_cost`` (AGENTS.md invariant 10).
    """

    def __init__(
        self, code: str, message: str, http_status: int = status.HTTP_400_BAD_REQUEST
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
