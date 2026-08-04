"""No-network SMS provider for local development and tests."""

import uuid
from decimal import Decimal

from apps.notifications.providers.base import DeliveryStatus, ProviderReceipt


class LogSmsProvider:
    """Accept messages without logging their PII-bearing body or phone."""

    name = "log"

    def send(self, to_phone: str, body: str) -> ProviderReceipt:
        return ProviderReceipt(message_id=f"local-{uuid.uuid4()}", cost=Decimal("0"))

    def fetch_status(self, provider_message_id: str) -> DeliveryStatus:
        return DeliveryStatus.DELIVERED
