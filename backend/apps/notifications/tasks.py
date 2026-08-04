"""Bounded-retry SMS delivery task."""

from typing import Any

from celery import shared_task
from django.db import connection, transaction

from apps.notifications.models import SmsLog
from apps.notifications.providers import get_provider
from apps.notifications.providers.base import ProviderError, SmsProvider
from core.db.rls import set_local_tenant


@shared_task(bind=True, max_retries=3)
def send_sms(self: Any, tenant_id: str, sms_log_id: str) -> None:
    """Deliver one queued row; duplicate task deliveries are harmless."""
    provider = get_provider()
    try:
        _send_once(tenant_id, sms_log_id, provider)
    except ProviderError as exc:
        if exc.retryable and self.request.retries < self.max_retries:
            raise self.retry(exc=exc, countdown=2**self.request.retries) from exc
        _mark_failed(tenant_id, sms_log_id, provider.name)


def _send_once(tenant_id: str, sms_log_id: str, provider: SmsProvider) -> None:
    with transaction.atomic():
        set_local_tenant(connection, tenant_id)
        row = SmsLog.objects.select_for_update().get(tenant_id=tenant_id, pk=sms_log_id)
        if row.status != SmsLog.Status.QUEUED:
            return
        receipt = provider.send(row.to_phone, row.body)
        row.provider = provider.name
        row.provider_message_id = receipt.message_id
        row.cost = receipt.cost
        row.status = SmsLog.Status.SENT
        row.save(
            update_fields=[
                "provider",
                "provider_message_id",
                "cost",
                "status",
                "updated_at",
            ]
        )


def _mark_failed(tenant_id: str, sms_log_id: str, provider_name: str) -> None:
    with transaction.atomic():
        set_local_tenant(connection, tenant_id)
        row = SmsLog.objects.select_for_update().get(tenant_id=tenant_id, pk=sms_log_id)
        if row.status != SmsLog.Status.QUEUED:
            return
        row.provider = provider_name
        row.status = SmsLog.Status.FAILED
        row.save(update_fields=["provider", "status", "updated_at"])
