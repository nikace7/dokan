"""Celery tasks for tenant plans and usage reconciliation."""

from celery import shared_task
from django.db import connection, transaction

from apps.tenants.constants import TenantStatus
from apps.tenants.models import Tenant
from apps.tenants.services import reconcile_tenant_usage
from core.db.rls import set_local_tenant


@shared_task
def reconcile_usage_snapshots() -> int:
    """Refresh every active tenant's usage under an isolated RLS transaction."""
    processed = 0
    tenant_ids = Tenant.objects.filter(
        status__in=TenantStatus.ACTIVE_STATUSES,
        deleted_at__isnull=True,
    ).values_list("pk", flat=True)
    for tenant_id in tenant_ids.iterator():
        with transaction.atomic():
            tenant = Tenant.objects.get(pk=tenant_id)
            set_local_tenant(connection, tenant.pk)
            reconcile_tenant_usage(tenant)
        processed += 1
    return processed
