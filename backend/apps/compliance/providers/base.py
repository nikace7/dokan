"""Vendor-neutral CBMS sync contract (mirrors the ADR 0004 SMS contract).

The real IRD/CBMS HTTP client goes behind this contract because the IRD's
technical requirements MUST be verified with a Nepali chartered accountant
or the IRD before live sync is enabled (design §1185) — and the penalty
for guessing wrong lands on the shop, not on us.
"""

from collections.abc import Mapping
from typing import Any, Protocol


class CbmsProviderError(Exception):
    """Provider rejection, classified for bounded Celery retries."""

    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class CbmsClient(Protocol):
    """One fiscal document in, a provider reference out."""

    name: str

    def submit_invoice(self, payload: Mapping[str, Any]) -> str: ...
