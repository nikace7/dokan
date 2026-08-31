"""Celery tasks for stock level, movement, transfer, count."""

import logging
from decimal import Decimal

from celery import shared_task
from django.db import connection, transaction

from apps.inventory.reconciliation import reconcile_stock_projection
from apps.tenants.constants import TenantStatus
from apps.tenants.models import Tenant
from core.db.rls import set_local_tenant

logger = logging.getLogger(__name__)


@shared_task
def reconcile_stock_levels() -> dict[str, int | str]:
    """Repair each active tenant's projection and emit an error-level drift alert."""
    tenants_processed = 0
    levels_checked = 0
    drifts_repaired = 0
    in_transit_qty = Decimal("0.000")
    tenant_ids = Tenant.objects.filter(
        status__in=TenantStatus.ACTIVE_STATUSES,
        deleted_at__isnull=True,
    ).values_list("pk", flat=True)

    for tenant_id in tenant_ids.iterator():
        with transaction.atomic():
            tenant = Tenant.objects.get(pk=tenant_id)
            set_local_tenant(connection, tenant.pk)
            result = reconcile_stock_projection(tenant)
        tenants_processed += 1
        levels_checked += result.levels_checked
        drifts_repaired += len(result.drifts)
        in_transit_qty += result.in_transit_qty
        if result.drifts:
            logger.error(
                "Stock projection drift repaired",
                extra={
                    "tenant_id": str(tenant.pk),
                    "drift_count": len(result.drifts),
                    "levels_checked": result.levels_checked,
                    "in_transit_qty": f"{result.in_transit_qty:.3f}",
                },
            )

    return {
        "tenants_processed": tenants_processed,
        "levels_checked": levels_checked,
        "drifts_repaired": drifts_repaired,
        "in_transit_qty": f"{in_transit_qty:.3f}",
    }
