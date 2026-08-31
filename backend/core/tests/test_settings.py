"""Deployment-setting safety contracts."""

from __future__ import annotations

import pytest

from config.settings.base import assert_production_email_backend


@pytest.mark.parametrize(
    "backend",
    [
        "django.core.mail.backends.console.EmailBackend",
        "django.core.mail.backends.locmem.EmailBackend",
        "django.core.mail.backends.dummy.EmailBackend",
    ],
)
def test_production_rejects_non_delivery_email_backends(backend: str) -> None:
    with pytest.raises(RuntimeError, match="EMAIL_BACKEND"):
        assert_production_email_backend(backend)


def test_production_accepts_delivery_email_backend() -> None:
    assert_production_email_backend("django.core.mail.backends.smtp.EmailBackend")
