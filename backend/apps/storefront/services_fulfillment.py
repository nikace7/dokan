"""Tenant-staff write paths for accepting and fulfilling online orders.

Preparing an order creates a normal HELD sale through the sales domain. That
keeps stock untouched until a staff member completes the bill in POS, where
the existing stock, numbering, tax, payment, and cash-session invariants run.
"""

from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from django.db import transaction

from apps.audit.services import audit
from apps.customers import services as customer_services
from apps.customers.models import Customer
from apps.pricing.rate_type_services import get_default_rate_type
from apps.sales.models import SalesInvoice
from apps.sales.services import SaleLineInput, cancel_held_bill, hold_bill
from apps.storefront import selectors
from apps.storefront.models import StoreCustomer, StoreOrder
from core.money import quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def _locked_order(tenant: "Tenant", order_id: UUID | str) -> StoreOrder:
    order = StoreOrder.objects.select_for_update().filter(tenant=tenant, pk=order_id).first()
    if order is None:
        raise ServiceError("ORDER_NOT_FOUND", "We could not find this order.", http_status=404)
    return order


def _address_text(order: StoreOrder) -> str | None:
    if not order.address:
        return None
    parts = [
        str(order.address.get(key, "")).strip() for key in ("line1", "area", "city", "landmark")
    ]
    value = ", ".join(part for part in parts if part)
    return value or None


def _ledger_customer(
    tenant: "Tenant",
    shopper: StoreCustomer,
    order: StoreOrder,
    actor: "User",
) -> Customer:
    locked = StoreCustomer.objects.select_for_update().get(tenant=tenant, pk=shopper.pk)
    if locked.ledger_customer_id:
        return Customer.objects.get(tenant=tenant, pk=locked.ledger_customer_id)

    phone = locked.phone.strip() or None
    customer = Customer.objects.filter(tenant=tenant, phone=phone).first() if phone else None
    if customer is None:
        customer = customer_services.create_customer(
            tenant,
            actor=actor,
            name=locked.full_name.strip() or locked.email,
            phone=phone,
            address=_address_text(order),
            note=f"Online shopper: {locked.email}",
        )
    locked.ledger_customer = customer
    locked.save(update_fields=["ledger_customer", "updated_at"])
    return customer


def _sale_lines(tenant: "Tenant", order: StoreOrder) -> list[SaleLineInput]:
    lines: list[SaleLineInput] = []
    for item in order.items.select_related("variant", "variant__item").all():
        display_base = item.compare_at or item.unit_price
        base = selectors.convert_for_display(
            display_base,
            from_currency=order.currency,
            to_currency=tenant.currency,
        )
        charged = selectors.convert_for_display(
            item.unit_price,
            from_currency=order.currency,
            to_currency=tenant.currency,
        )
        discount = quantize_money((base - charged) * item.qty)
        lines.append(
            SaleLineInput(
                variant=item.variant,
                qty=item.qty,
                unit_price=base,
                discount=max(discount, Decimal("0")),
            )
        )
    return lines


@transaction.atomic
def prepare_order(tenant: "Tenant", *, order_id: UUID | str, actor: "User") -> StoreOrder:
    """Accept a placed order and link exactly one HELD POS bill."""
    order = _locked_order(tenant, order_id)
    if order.sales_invoice_id:
        if order.status in {
            StoreOrder.Status.CONFIRMED,
            StoreOrder.Status.PACKED,
            StoreOrder.Status.SHIPPED,
        }:
            return order
        raise ServiceError(
            "ORDER_NOT_PREPARABLE", "This order cannot be prepared in its current state.", 409
        )
    if order.status != StoreOrder.Status.PLACED:
        raise ServiceError(
            "ORDER_NOT_PREPARABLE", "Only a placed order can be prepared.", http_status=409
        )

    shopper = StoreCustomer.objects.get(tenant=tenant, pk=order.customer_id)
    customer = _ledger_customer(tenant, shopper, order, actor)
    result = hold_bill(
        tenant,
        branch=order.branch,
        rate_type=get_default_rate_type(tenant),
        lines=_sale_lines(tenant, order),
        customer=customer,
        idempotency_key=f"store-order:{order.pk}",
        created_by=actor,
    )
    order.sales_invoice = result.invoice
    order.status = StoreOrder.Status.CONFIRMED
    order.save(update_fields=["sales_invoice", "status", "updated_at"])
    audit(
        tenant,
        actor=actor,
        action="store.order.prepare",
        target_type="store_order",
        target_id=order,
        before={"status": StoreOrder.Status.PLACED},
        after={
            "status": StoreOrder.Status.CONFIRMED,
            "sales_invoice_id": str(result.invoice.pk),
        },
    )
    return order


@transaction.atomic
def advance_order(tenant: "Tenant", *, order_id: UUID | str, actor: "User") -> StoreOrder:
    """Advance CONFIRMED → PACKED → SHIPPED → DELIVERED."""
    order = _locked_order(tenant, order_id)
    transitions: dict[str, str] = {
        StoreOrder.Status.CONFIRMED: StoreOrder.Status.PACKED,
        StoreOrder.Status.PACKED: StoreOrder.Status.SHIPPED,
    }
    next_status = transitions.get(order.status)
    if order.status == StoreOrder.Status.SHIPPED:
        invoice = (
            SalesInvoice.objects.filter(tenant=tenant, pk=order.sales_invoice_id).first()
            if order.sales_invoice_id
            else None
        )
        if invoice is None or invoice.status != SalesInvoice.Status.COMPLETED:
            raise ServiceError(
                "SALE_NOT_COMPLETED",
                "Complete the linked POS bill before marking this order delivered.",
                http_status=409,
            )
        next_status = StoreOrder.Status.DELIVERED
        if invoice.due_amount == Decimal("0"):
            order.payment_status = StoreOrder.PaymentStatus.PAID
    if next_status is None:
        raise ServiceError(
            "ORDER_STATUS_INVALID",
            "This order cannot move to another fulfillment stage.",
            http_status=409,
        )

    previous = order.status
    order.status = next_status
    update_fields = ["status", "updated_at"]
    if next_status == StoreOrder.Status.DELIVERED:
        update_fields.append("payment_status")
    order.save(update_fields=update_fields)
    audit(
        tenant,
        actor=actor,
        action="store.order.advance",
        target_type="store_order",
        target_id=order,
        before={"status": previous},
        after={"status": next_status},
    )
    return order


@transaction.atomic
def cancel_order(tenant: "Tenant", *, order_id: UUID | str, actor: "User") -> StoreOrder:
    """Cancel an uncompleted online order and release its reservation."""
    order = _locked_order(tenant, order_id)
    if order.status == StoreOrder.Status.CANCELLED:
        return order
    if order.status == StoreOrder.Status.DELIVERED:
        raise ServiceError(
            "ORDER_NOT_CANCELLABLE", "A delivered order cannot be cancelled.", http_status=409
        )
    invoice = (
        SalesInvoice.objects.filter(tenant=tenant, pk=order.sales_invoice_id).first()
        if order.sales_invoice_id
        else None
    )
    if invoice is not None:
        if invoice.status == SalesInvoice.Status.COMPLETED:
            raise ServiceError(
                "COMPLETED_ORDER_CANNOT_CANCEL",
                "A completed bill must be corrected with a return, not cancellation.",
                http_status=409,
            )
        if invoice.status == SalesInvoice.Status.HELD:
            cancel_held_bill(tenant, invoice=invoice)

    previous = order.status
    order.status = StoreOrder.Status.CANCELLED
    order.save(update_fields=["status", "updated_at"])
    audit(
        tenant,
        actor=actor,
        action="store.order.cancel",
        target_type="store_order",
        target_id=order,
        before={"status": previous},
        after={"status": StoreOrder.Status.CANCELLED},
    )
    return order
