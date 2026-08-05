"""Configured CBMS client resolver (settings.CBMS_PROVIDER)."""

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from apps.compliance.providers.base import CbmsClient
from apps.compliance.providers.cbms import CbmsHttpClient
from apps.compliance.providers.local import LocalCbmsClient


def get_cbms_client() -> CbmsClient:
    """Return the configured client; unknown providers fail loudly."""
    name = str(getattr(settings, "CBMS_PROVIDER", "local")).strip().lower()
    if name == "local":
        return LocalCbmsClient()
    if name == "cbms":
        return CbmsHttpClient()
    raise ImproperlyConfigured(f"Unsupported CBMS_PROVIDER: {name!r}")


__all__ = ["get_cbms_client"]
