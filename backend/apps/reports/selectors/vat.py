"""VAT register selectors — the IRD-flavored sales and purchase registers."""

from typing import TYPE_CHECKING, Any

from apps.purchasing.models import PurchaseInvoice
from apps.reports.selectors._shared import resolve_date_range
from apps.sales.models import SalesInvoice

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_COMPLETED = SalesInvoice.Status.COMPLETED
_SALE = SalesInvoice.DocType.SALE
_RETURN = SalesInvoice.DocType.RETURN


def sales_vat_register(
    tenant: "Tenant",
    user: "User",
    *,
    date_from_bs: str | None = None,
    date_to_bs: str | None = None,
) -> dict[str, Any]:
    """Per VAT bill (is_vat_bill, COMPLETED): number, BS date, customer,
    taxable, VAT, total — plus a totals row. Returns appear as their own
    rows (doc_type RETURN) since the IRD expects credit notes listed.
    Customer PAN is not modeled yet — the column is present as null
    (deferral note in the slice report).
    """
    from_bs, to_bs = resolve_date_range(date_from_bs, date_to_bs)
    qs = (
        SalesInvoice.objects.filter(
            tenant=tenant,
            status=_COMPLETED,
            is_vat_bill=True,
            business_date_bs__gte=from_bs,
            business_date_bs__lte=to_bs,
        )
        .select_related("customer")
        .order_by("business_date_bs", "invoice_no")
    )
    rows = [
        {
            "invoice_no": invoice.invoice_no,
            "doc_type": invoice.doc_type,
            "business_date_bs": invoice.business_date_bs,
            "customer_name": invoice.customer.name if invoice.customer else None,
            "customer_pan": ((invoice.customer.pan or "—") if invoice.customer else None),
            "taxable_amount": str(invoice.taxable_amount),
            "vat_amount": str(invoice.vat_amount),
            "total": str(invoice.total),
        }
        for invoice in qs
    ]
    totals = {
        "taxable_amount": str(sum(invoice.taxable_amount for invoice in qs)),
        "vat_amount": str(sum(invoice.vat_amount for invoice in qs)),
        "total": str(sum(invoice.total for invoice in qs)),
    }
    return {"date_from_bs": from_bs, "date_to_bs": to_bs, "rows": rows, "totals": totals}


def purchase_vat_register(
    tenant: "Tenant",
    user: "User",
    *,
    date_from_bs: str | None = None,
    date_to_bs: str | None = None,
) -> dict[str, Any]:
    """Per confirmed VAT purchase bill: number, BS date, supplier + PAN,
    taxable, VAT, total — plus a totals row."""
    from_bs, to_bs = resolve_date_range(date_from_bs, date_to_bs)
    qs = (
        PurchaseInvoice.objects.filter(
            tenant=tenant,
            status=PurchaseInvoice.Status.CONFIRMED,
            is_vat_bill=True,
            bill_date_bs__gte=from_bs,
            bill_date_bs__lte=to_bs,
        )
        .select_related("supplier")
        .order_by("bill_date_bs", "invoice_no")
    )
    rows = [
        {
            "invoice_no": invoice.invoice_no,
            "bill_date_bs": invoice.bill_date_bs,
            "supplier_name": invoice.supplier.name,
            "supplier_pan": invoice.supplier.pan_no,
            "taxable_amount": str(invoice.taxable_amount),
            "vat_amount": str(invoice.vat_amount),
            "total": str(invoice.total),
        }
        for invoice in qs
    ]
    totals = {
        "taxable_amount": str(sum(invoice.taxable_amount for invoice in qs)),
        "vat_amount": str(sum(invoice.vat_amount for invoice in qs)),
        "total": str(sum(invoice.total for invoice in qs)),
    }
    return {"date_from_bs": from_bs, "date_to_bs": to_bs, "rows": rows, "totals": totals}
