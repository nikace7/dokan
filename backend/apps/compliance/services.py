"""CBMS enqueue service — the durable sync queue's write path.

Enqueued by sales services (explicit calls, never signals) when a fiscal
document completes: ``finalize_invoice`` (sales, held completions,
exchange sales) and ``_create_return_invoice`` (returns, exchange
returns). One queue row per document (UNIQUE tenant+invoice) — calling
enqueue twice for the same document returns the existing row without
re-dispatching (duplicate-task protection).

Payload fields follow the IRD-required invoice content (see
docs/COMPLIANCE_IRD.md); the snapshot is frozen at completion so later
master-data edits never change what was sent.
"""

from typing import TYPE_CHECKING, Any

from apps.compliance.models import CbmsSyncLog
from apps.compliance.tasks import sync_cbms_invoice

if TYPE_CHECKING:
    from apps.sales.models import SalesInvoice
    from apps.tenants.models import Tenant

_SYNCABLE_DOC_TYPES = frozenset({"SALE", "RETURN"})


def build_payload(tenant: "Tenant", invoice: "SalesInvoice") -> dict[str, Any]:
    """The frozen per-document CBMS payload snapshot."""
    return {
        "seller_pan": tenant.pan_vat_no,
        "invoice_no": f"{invoice.branch.invoice_prefix}-{invoice.fiscal_year_bs}-"
        f"{invoice.invoice_no:06d}",
        "doc_type": invoice.doc_type,
        "original_invoice_no": (
            f"{invoice.branch.invoice_prefix}-{invoice.original_invoice.fiscal_year_bs}-"
            f"{invoice.original_invoice.invoice_no:06d}"
            if invoice.original_invoice
            else None
        ),
        "business_date_bs": invoice.business_date_bs,
        "fiscal_year_bs": invoice.fiscal_year_bs,
        "is_vat_bill": invoice.is_vat_bill,
        "customer_name": invoice.customer.name if invoice.customer else None,
        "customer_pan": (invoice.customer.pan if invoice.customer else None),
        "lines": [
            {
                "sku": item.variant.sku,
                "item_name": item.variant.item.name,
                "qty": str(item.qty),
                "unit_price": str(item.unit_price),
                "discount": str(item.discount),
                "line_total": str(item.line_total),
            }
            for item in invoice.items.select_related("variant", "variant__item")
        ],
        "subtotal": str(invoice.subtotal),
        "discount_amount": str(invoice.discount_amount),
        "taxable_amount": str(invoice.taxable_amount),
        "vat_amount": str(invoice.vat_amount),
        "total": str(invoice.total),
        "paid_amount": str(invoice.paid_amount),
        "due_amount": str(invoice.due_amount),
    }


def enqueue_for_sync(tenant: "Tenant", *, invoice: "SalesInvoice") -> CbmsSyncLog:
    """Queue a completed fiscal document for CBMS sync (idempotent).

    MUST be called inside the completing transaction so the queue row and
    the document commit together. Dispatches the Celery task directly:
    an async worker racing the commit is harmless — the task treats a
    missing row as retryable and the bounded retry picks it up after
    commit. (documented trade-off vs transaction.on_commit, which never
    fires under the test transaction wrapper).
    """
    if invoice.doc_type not in _SYNCABLE_DOC_TYPES:
        from core.responses import ServiceError

        raise ServiceError(
            "CBMS_DOC_TYPE_INVALID",
            "Only completed SALE and RETURN documents sync to CBMS.",
            http_status=409,
        )
    if invoice.status != "COMPLETED" or invoice.invoice_no is None:
        from core.responses import ServiceError

        raise ServiceError(
            "CBMS_NOT_COMPLETED",
            "Only completed invoices with a number sync to CBMS.",
            http_status=409,
        )
    row, created = CbmsSyncLog.objects.get_or_create(
        tenant=tenant,
        invoice=invoice,
        defaults={"payload": build_payload(tenant, invoice)},
    )
    if created:
        sync_cbms_invoice.delay(str(tenant.pk), str(row.pk))
    return row
