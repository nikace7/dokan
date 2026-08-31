"""Gunicorn process settings and Prometheus worker cleanup."""

from __future__ import annotations

import os
from typing import Any

from prometheus_client import multiprocess

bind = "0.0.0.0:8000"
workers = int(os.environ.get("GUNICORN_WORKERS", "4"))
accesslog = None  # ObservabilityMiddleware emits route-safe request events.


def child_exit(server: Any, worker: Any) -> None:
    """Remove stale live-gauge files when a worker exits."""
    del server
    multiprocess.mark_process_dead(worker.pid)
