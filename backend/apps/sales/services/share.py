"""Shareable online bill — one write-once public token per completed sale.

The token is an unguessable UUID; possessing it authorizes reading the
receipt payload (and nothing else) via the public route. Only COMPLETED
invoices can be shared (#3: sharing never alters any financial field).
"""

import uuid
from typing import TYPE_CHECKING

from django.db import transaction

from apps.audit.services import audit
from apps.sales.models import SalesInvoice
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


@transaction.atomic
def get_or_create_share_token(
    tenant: "Tenant", *, invoice: SalesInvoice, actor: "User"
) -> SalesInvoice:
    """Return the invoice's share token, creating it idempotently.

    Concurrent/repeated calls return the SAME token: the row lock makes the
    first writer win and later calls read the stored value. Writes the
    ``sale.share`` audit event only when a token is actually created.
    """
    locked = SalesInvoice.objects.select_for_update().get(tenant=tenant, pk=invoice.pk)
    if locked.status != SalesInvoice.Status.COMPLETED:
        raise ServiceError(
            "INVOICE_NOT_SHAREABLE",
            "Only completed bills can be shared.",
            http_status=409,
        )
    if locked.share_token is not None:
        return locked
    locked.share_token = uuid.uuid4()
    locked.save(update_fields=["share_token", "updated_at"])
    audit(
        tenant,
        actor=actor,
        action="sale.share",
        target_type="sales_invoice",
        target_id=locked,
        after={"share_token": str(locked.share_token)},
    )
    return locked
