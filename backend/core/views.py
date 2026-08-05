"""Platform infrastructure endpoints."""

from django.core.cache import cache
from django.db import connection
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET

_CACHE_KEY = "healthcheck:readiness"


@require_GET
def healthcheck(_request: HttpRequest) -> JsonResponse:
    """Report readiness without exposing dependency addresses or errors."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            if cursor.fetchone() != (1,):
                raise RuntimeError("database readiness probe returned an unexpected value")
        cache.set(_CACHE_KEY, "ok", timeout=5)
        if cache.get(_CACHE_KEY) != "ok":
            raise RuntimeError("cache readiness probe returned an unexpected value")
    except Exception:
        return JsonResponse({"status": "unhealthy"}, status=503)
    return JsonResponse({"status": "ok", "database": "ok", "cache": "ok"})
