"""Bounded-retry CBMS sync task (mirrors the notifications SMS task).

Retry policy: exponential backoff (30s × 2^n), 4 retries = 5 attempts
total, then FAILED with the last error kept on the row. A row missing at
task start (worker racing the enqueue commit) is treated as retryable —
the retry picks it up after the commit lands. Duplicate deliveries are
harmless: only PENDING rows are attempted.
"""

from typing import Any

from celery import shared_task
from django.db import connection, transaction
from django.utils import timezone

from apps.compliance.models import CbmsSyncLog
from apps.compliance.providers import get_cbms_client
from apps.compliance.providers.base import CbmsClient, CbmsProviderError
from core.db.rls import set_local_tenant

#: Bounded retry: max_retries=4 → at most 5 attempts per document.
BASE_RETRY_SECONDS = 30


@shared_task(bind=True, max_retries=4)
def sync_cbms_invoice(self: Any, tenant_id: str, log_id: str) -> None:
    """Sync one queued row; duplicate deliveries are harmless."""
    client = get_cbms_client()
    try:
        _attempt_once(tenant_id, log_id, client)
    except CbmsSyncLog.DoesNotExist as exc:
        # Worker raced the enqueue's commit — retryable by definition.
        if self.request.retries < self.max_retries:
            raise self.retry(
                exc=exc, countdown=BASE_RETRY_SECONDS * 2**self.request.retries
            ) from exc
    except CbmsProviderError as exc:
        if exc.retryable and self.request.retries < self.max_retries:
            _record_attempt(tenant_id, log_id, str(exc)[:500], retries=self.request.retries + 1)
            raise self.retry(
                exc=exc, countdown=BASE_RETRY_SECONDS * 2**self.request.retries
            ) from exc
        _mark_failed(tenant_id, log_id, str(exc)[:500], retries=self.request.retries + 1)


def _attempt_once(tenant_id: str, log_id: str, client: CbmsClient) -> None:
    with transaction.atomic():
        set_local_tenant(connection, tenant_id)
        row = CbmsSyncLog.objects.select_for_update().get(tenant_id=tenant_id, pk=log_id)
        if row.status != CbmsSyncLog.Status.PENDING:
            return  # already synced/failed by a duplicate delivery
        client.submit_invoice(row.payload)
        row.status = CbmsSyncLog.Status.SYNCED
        row.synced_at = timezone.now()
        row.last_error = None
        row.save(update_fields=["status", "synced_at", "last_error", "updated_at"])


def _record_attempt(tenant_id: str, log_id: str, error: str, *, retries: int) -> None:
    with transaction.atomic():
        set_local_tenant(connection, tenant_id)
        row = CbmsSyncLog.objects.select_for_update().get(tenant_id=tenant_id, pk=log_id)
        if row.status != CbmsSyncLog.Status.PENDING:
            return
        row.attempts = retries
        row.last_error = error
        row.save(update_fields=["attempts", "last_error", "updated_at"])


def _mark_failed(tenant_id: str, log_id: str, error: str, *, retries: int) -> None:
    with transaction.atomic():
        set_local_tenant(connection, tenant_id)
        row = CbmsSyncLog.objects.select_for_update().get(tenant_id=tenant_id, pk=log_id)
        if row.status != CbmsSyncLog.Status.PENDING:
            return
        row.attempts = retries
        row.last_error = error
        row.status = CbmsSyncLog.Status.FAILED
        row.save(update_fields=["attempts", "last_error", "status", "updated_at"])
