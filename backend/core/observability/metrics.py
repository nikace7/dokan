"""Low-cardinality Prometheus application metrics."""

from __future__ import annotations

import os

from prometheus_client import (
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    multiprocess,
)

HTTP_REQUESTS = Counter(
    "dokan_http_requests_total",
    "Completed HTTP requests.",
    ("method", "route", "status"),
)
HTTP_DURATION = Histogram(
    "dokan_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ("method", "route"),
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)
HTTP_IN_PROGRESS = Gauge(
    "dokan_http_requests_in_progress",
    "HTTP requests currently being processed.",
    multiprocess_mode="livesum",
)


def observe_request(*, method: str, route: str, status: int, duration: float) -> None:
    """Record one request using only bounded labels."""
    HTTP_REQUESTS.labels(method=method, route=route, status=str(status)).inc()
    HTTP_DURATION.labels(method=method, route=route).observe(duration)


def metrics_payload() -> bytes:
    """Collect one process locally or aggregate every live Gunicorn worker."""
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry(support_collectors_without_names=True)
        multiprocess.MultiProcessCollector(registry)
        return generate_latest(registry)
    return generate_latest()
