"""Configured SMS provider resolver."""

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from apps.notifications.providers.base import SmsProvider
from apps.notifications.providers.log import LogSmsProvider


def get_provider() -> SmsProvider:
    """Return the configured adapter; unknown providers fail loudly."""
    name = str(getattr(settings, "SMS_PROVIDER", "log")).strip().lower()
    if name == "log":
        return LogSmsProvider()
    raise ImproperlyConfigured(f"Unsupported SMS_PROVIDER: {name!r}")


__all__ = ["get_provider"]
