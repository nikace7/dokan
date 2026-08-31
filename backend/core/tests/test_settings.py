"""Deployment-setting safety contracts."""

from __future__ import annotations

import pytest

from config.settings.base import assert_production_email_backend, assert_transaction_pooling


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


@pytest.mark.parametrize("pool_mode", [None, "", "direct", "session", "statement"])
def test_production_rejects_non_transaction_database_pooling(pool_mode: str | None) -> None:
    with pytest.raises(RuntimeError, match="DATABASE_POOL_MODE"):
        assert_transaction_pooling(pool_mode)


def test_production_accepts_transaction_database_pooling() -> None:
    assert_transaction_pooling("transaction")
