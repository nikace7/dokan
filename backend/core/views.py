"""Platform infrastructure endpoints."""

import logging

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import Http404, HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.http import require_GET
from prometheus_client import CONTENT_TYPE_LATEST

from core.observability.metrics import metrics_payload

_CACHE_KEY = "healthcheck:readiness"
logger = logging.getLogger("dokan.health")


@require_GET
def liveness(_request: HttpRequest) -> JsonResponse:
    """Prove the application process can serve requests without dependencies."""
    return JsonResponse({"status": "ok"})


@require_GET
def healthcheck(_request: HttpRequest) -> JsonResponse:
    """Report readiness without exposing dependency addresses or errors."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            if cursor.fetchone() != (1,):
                raise RuntimeError("database readiness probe returned an unexpected value")
    except Exception:
        logger.error("readiness.failed", extra={"dependency": "database"})
        return JsonResponse({"status": "unhealthy"}, status=503)

    try:
        cache.set(_CACHE_KEY, "ok", timeout=5)
        if cache.get(_CACHE_KEY) != "ok":
            raise RuntimeError("cache readiness probe returned an unexpected value")
    except Exception:
        logger.error("readiness.failed", extra={"dependency": "cache"})
        return JsonResponse({"status": "unhealthy"}, status=503)
    return JsonResponse({"status": "ok", "database": "ok", "cache": "ok"})


@require_GET
def metrics(_request: HttpRequest) -> HttpResponse:
    """Expose internal metrics; Caddy blocks this path at the public edge."""
    if not settings.METRICS_ENABLED:
        raise Http404
    return HttpResponse(metrics_payload(), content_type=CONTENT_TYPE_LATEST)
