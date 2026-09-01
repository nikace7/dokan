"""Structured logging that exposes only an explicit safe-field allowlist."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import ClassVar


class JsonFormatter(logging.Formatter):
    """Render a stable JSON event without serializing arbitrary record data."""

    safe_fields: ClassVar[tuple[str, ...]] = (
        "request_id",
        "method",
        "route",
        "status_code",
        "duration_ms",
        "dependency",
        "task_name",
        "repaired_rows",
    )

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in self.safe_fields:
            if hasattr(record, field):
                payload[field] = getattr(record, field)
        if record.exc_info and record.exc_info[0] is not None:
            payload["exception_type"] = record.exc_info[0].__name__
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
