"""Privacy-safe observability contract tests."""

from __future__ import annotations

import json
import logging
import re
from unittest.mock import patch

import pytest
from django.db import OperationalError
from django.test import Client, override_settings

from core.observability.logging import JsonFormatter
from core.observability.sentry import scrub_event

_UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


def test_liveness_does_not_touch_dependencies() -> None:
    with (
        patch("core.views.connection.cursor", side_effect=AssertionError("database touched")),
        patch("core.views.cache.get", side_effect=AssertionError("cache touched")),
    ):
        response = Client().get("/api/live", headers={"host": "app.dokan.com.np"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_request_id_is_validated_and_returned() -> None:
    supplied = "f73ee071-caf1-45dc-8f9a-b1dc5b553b1e"
    accepted = Client().get(
        "/api/live", headers={"host": "app.dokan.com.np", "x-request-id": supplied}
    )
    generated = Client().get(
        "/api/live", headers={"host": "app.dokan.com.np", "x-request-id": "not-safe"}
    )

    assert accepted.headers["X-Request-ID"] == supplied
    assert _UUID_PATTERN.fullmatch(generated.headers["X-Request-ID"])


def test_request_log_uses_route_name_not_raw_url(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="dokan.request"):
        response = Client().get(
            "/api/live?shared_token=must-not-leak", headers={"host": "app.dokan.com.np"}
        )

    record = next(item for item in caplog.records if item.getMessage() == "request.completed")
    assert record.route == "liveness"
    assert record.method == "GET"
    assert record.status_code == response.status_code
    assert record.duration_ms >= 0
    assert record.request_id == response.headers["X-Request-ID"]
    assert "must-not-leak" not in caplog.text


@override_settings(METRICS_ENABLED=True)
def test_metrics_expose_bounded_http_labels() -> None:
    client = Client()
    client.get("/api/live", headers={"host": "app.dokan.com.np"})

    response = client.get("/api/metrics", headers={"host": "app.dokan.com.np"})

    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/plain")
    body = response.content.decode()
    assert "dokan_http_requests_total" in body
    assert 'method="GET"' in body
    assert 'route="liveness"' in body
    assert 'tenant="' not in body
    assert 'user="' not in body


def test_metrics_fail_closed_by_default() -> None:
    response = Client().get("/api/metrics", headers={"host": "app.dokan.com.np"})

    assert response.status_code == 404


def test_readiness_logs_dependency_without_exception_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with (
        caplog.at_level(logging.ERROR, logger="dokan.health"),
        patch(
            "core.views.connection.cursor",
            side_effect=OperationalError("postgresql://user:secret@private-host/database"),
        ),
    ):
        response = Client().get("/api/health", headers={"host": "app.dokan.com.np"})

    record = next(item for item in caplog.records if item.getMessage() == "readiness.failed")
    assert response.status_code == 503
    assert record.dependency == "database"
    assert "private-host" not in caplog.text
    assert "secret" not in caplog.text


def test_json_formatter_emits_only_structured_safe_fields() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="dokan.request",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="request.completed",
        args=(),
        exc_info=None,
    )
    record.request_id = "f73ee071-caf1-45dc-8f9a-b1dc5b553b1e"
    record.route = "liveness"
    record.status_code = 200

    payload = json.loads(formatter.format(record))

    assert payload["message"] == "request.completed"
    assert payload["request_id"] == record.request_id
    assert payload["route"] == "liveness"
    assert payload["status_code"] == 200
    assert "pathname" not in payload


def test_sentry_scrubber_drops_pii_secrets_and_costs() -> None:
    event = {
        "request": {
            "headers": {
                "Authorization": "Bearer secret",
                "User-Agent": "browser",
                "X-Forwarded-For": "192.0.2.10",
                "X-Request-ID": "safe-id",
            },
            "data": {"phone": "9812345678"},
            "cookies": {"session": "secret"},
        },
        "user": {"email": "owner@example.com"},
        "extra": {"cost_at_sale": "100.00", "request_id": "safe-id"},
        "message": "owner@example.com failed with token secret",
        "logentry": {"message": "phone 9812345678"},
    }

    scrubbed = scrub_event(event, hint={})

    assert scrubbed is not None
    assert "user" not in scrubbed
    request = scrubbed.get("request")
    assert isinstance(request, dict)
    assert "data" not in request
    assert "cookies" not in request
    headers = request.get("headers")
    assert isinstance(headers, dict)
    assert "Authorization" not in headers
    assert headers["User-Agent"] == "browser"
    assert headers["X-Request-ID"] == "safe-id"
    assert "X-Forwarded-For" not in headers
    extra = scrubbed.get("extra")
    assert isinstance(extra, dict)
    assert "cost_at_sale" not in extra
    assert extra["request_id"] == "safe-id"
    assert "message" not in scrubbed
    assert "logentry" not in scrubbed
