"""Optional Sentry initialization with aggressive privacy filtering."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sentry_sdk.types import Event

_SENSITIVE_PARTS = (
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
    "phone",
    "email",
    "cost",
    "price",
)

_SAFE_REQUEST_HEADERS = {"user-agent", "x-request-id"}


def _is_sensitive(key: object) -> bool:
    normalized = str(key).lower().replace("-", "_")
    return any(part in normalized for part in _SENSITIVE_PARTS)


def _scrub_mapping(value: Mapping[Any, Any]) -> dict[str, Any]:
    scrubbed: dict[str, Any] = {}
    for key, child in value.items():
        if _is_sensitive(key):
            continue
        scrubbed[str(key)] = _scrub_value(child)
    return scrubbed


def _scrub_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return _scrub_mapping(value)
    if isinstance(value, list):
        return [_scrub_value(item) for item in value]
    return value


def scrub_event(event: Event, hint: dict[str, Any]) -> Event | None:
    """Remove request payloads, identity, secrets, and financial values."""
    del hint
    event.pop("user", None)
    event.pop("breadcrumbs", None)
    event.pop("message", None)
    event.pop("logentry", None)
    request = event.get("request")
    if isinstance(request, dict):
        for field in ("cookies", "data", "env", "query_string", "url"):
            request.pop(field, None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                str(key): value
                for key, value in headers.items()
                if str(key).lower() in _SAFE_REQUEST_HEADERS
            }
    event["extra"] = _scrub_mapping(event.get("extra", {}))
    for exception in event.get("exception", {}).get("values", []):
        if isinstance(exception, dict) and "value" in exception:
            exception["value"] = "[Filtered]"
    return event


def configure_sentry(
    *, dsn: str, environment: str, release: str | None, traces_sample_rate: float
) -> bool:
    """Initialize Sentry only when a deployment provides a DSN."""
    if not dsn:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release or None,
        send_default_pii=False,
        max_request_body_size="never",
        traces_sample_rate=traces_sample_rate,
        before_send=scrub_event,
    )
    return True
