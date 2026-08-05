"""Immutable receipt-print tracking."""

from typing import TYPE_CHECKING

from django.db import transaction

from apps.audit.models import AuditLog
from apps.audit.services import audit
from apps.sales.models import SalesInvoice
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


@transaction.atomic
def record_receipt_print(tenant: "Tenant", *, invoice: SalesInvoice, actor: "User") -> int:
    """Record a print request without mutating the completed invoice."""
    locked = SalesInvoice.objects.select_for_update().get(tenant=tenant, pk=invoice.pk)
    if locked.status != SalesInvoice.Status.COMPLETED:
        raise ServiceError(
            "RECEIPT_NOT_PRINTABLE",
            "Only completed bills can be printed.",
            http_status=409,
        )
    print_count = (
        AuditLog.objects.filter(
            tenant=tenant,
            action="sale.receipt.print",
            target_type="sales_invoice",
            target_id=locked.pk,
        ).count()
        + 1
    )
    audit(
        tenant,
        actor=actor,
        action="sale.receipt.print",
        target_type="sales_invoice",
        target_id=locked,
        after={"print_count": print_count},
    )
    return print_count
