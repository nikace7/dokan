"""Read-side queries for customers; every selector takes an explicit ``user``."""

from decimal import Decimal
from typing import TYPE_CHECKING

from django.db.models import QuerySet, Sum

from apps.customers.models import Customer
from apps.sales.models import SalesInvoice
from core.money import quantize_money

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def list_customers(
    tenant: "Tenant",
    user: "User",
    *,
    is_active: bool | None = None,
    search: str = "",
) -> QuerySet[Customer]:
    """Customer list with name/phone search (POS customer attach)."""
    qs = Customer.objects.filter(tenant=tenant)
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    if search:
        qs = (qs.filter(name__icontains=search) | qs.filter(phone__icontains=search)).distinct()
    return qs.order_by("name")


def get_customer_outstanding(tenant: "Tenant", customer: Customer) -> Decimal:
    """Udharo outstanding = opening balance + sale dues − credit notes.

    Credit notes are the CREDIT_NOTE entries in RETURN invoices' refunds
    lists — the original invoice is never edited to apply a return credit
    (invariant 3), so outstanding is a computed view.
    """
    dues = SalesInvoice.objects.filter(
        tenant=tenant,
        customer=customer,
        doc_type=SalesInvoice.DocType.SALE,
        status=SalesInvoice.Status.COMPLETED,
    ).aggregate(total=Sum("due_amount"))["total"] or Decimal("0")

    credit_notes = Decimal("0")
    refunds_lists = SalesInvoice.objects.filter(
        tenant=tenant, customer=customer, doc_type=SalesInvoice.DocType.RETURN
    ).values_list("refunds", flat=True)
    for refunds in refunds_lists:
        for refund in refunds:
            if refund.get("method") == "CREDIT_NOTE":
                credit_notes += Decimal(str(refund.get("amount", "0")))

    return quantize_money(customer.opening_balance + dues - credit_notes)


def get_customer_outstanding_breakdown(tenant: "Tenant", customer: Customer) -> dict[str, Decimal]:
    """The components of outstanding, for the customer detail screen."""
    dues = SalesInvoice.objects.filter(
        tenant=tenant,
        customer=customer,
        doc_type=SalesInvoice.DocType.SALE,
        status=SalesInvoice.Status.COMPLETED,
    ).aggregate(total=Sum("due_amount"))["total"] or Decimal("0")

    credit_notes = Decimal("0")
    refunds_lists = SalesInvoice.objects.filter(
        tenant=tenant, customer=customer, doc_type=SalesInvoice.DocType.RETURN
    ).values_list("refunds", flat=True)
    for refunds in refunds_lists:
        for refund in refunds:
            if refund.get("method") == "CREDIT_NOTE":
                credit_notes += Decimal(str(refund.get("amount", "0")))

    return {
        "opening_balance": quantize_money(customer.opening_balance),
        "due_amount": quantize_money(dues),
        "credit_notes": quantize_money(credit_notes),
        "outstanding": quantize_money(customer.opening_balance + dues - credit_notes),
    }
