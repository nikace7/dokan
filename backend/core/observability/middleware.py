"""Request correlation, structured access logging, and HTTP metrics."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable

from django.conf import settings
from django.http import HttpRequest, HttpResponse

from core.observability.metrics import HTTP_IN_PROGRESS, observe_request

logger = logging.getLogger("dokan.request")


def _request_id(raw: str | None) -> str:
    if raw:
        try:
            parsed = uuid.UUID(raw)
            if parsed.version == 4 and str(parsed) == raw.lower():
                return str(parsed)
        except (ValueError, AttributeError):
            pass
    return str(uuid.uuid4())


def _route_name(request: HttpRequest) -> str:
    match = request.resolver_match
    if match is None:
        return "unmatched"
    return match.view_name or match.url_name or "unnamed"


class ObservabilityMiddleware:
    """Attach a request id and emit privacy-safe completion signals."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        request_id = _request_id(request.headers.get("X-Request-ID"))
        request.request_id = request_id  # type: ignore[attr-defined]
        started = time.perf_counter()
        method = request.method or "UNKNOWN"
        metrics_enabled = settings.METRICS_ENABLED
        if metrics_enabled:
            HTTP_IN_PROGRESS.inc()
        try:
            response = self.get_response(request)
        finally:
            if metrics_enabled:
                HTTP_IN_PROGRESS.dec()

        duration = time.perf_counter() - started
        route = _route_name(request)
        if metrics_enabled:
            observe_request(
                method=method,
                route=route,
                status=response.status_code,
                duration=duration,
            )
        logger.info(
            "request.completed",
            extra={
                "request_id": request_id,
                "method": method,
                "route": route,
                "status_code": response.status_code,
                "duration_ms": round(duration * 1000, 2),
            },
        )
        response.headers["X-Request-ID"] = request_id
        return response
