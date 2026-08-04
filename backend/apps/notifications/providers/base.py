"""Vendor-neutral SMS contract from ADR 0004."""

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Protocol


class DeliveryStatus(StrEnum):
    SENT = "SENT"
    DELIVERED = "DELIVERED"
    FAILED = "FAILED"


@dataclass(frozen=True)
class ProviderReceipt:
    message_id: str
    cost: Decimal


class ProviderError(Exception):
    """Provider rejection, classified for bounded Celery retries."""

    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class SmsProvider(Protocol):
    name: str

    def send(self, to_phone: str, body: str) -> ProviderReceipt: ...

    def fetch_status(self, provider_message_id: str) -> DeliveryStatus: ...
