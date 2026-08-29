"""Checkout — one transaction per order, prices resolved server-side.

The cart is client-side; this service is the single point of truth for what
an order costs. Unit prices come from the discounted website price first,
falling back to the variant/item minimum selling price converted into the
store's display currency at the NPR/INR peg. Stock is validated but never
decremented here — the shop confirms the order in the POS, which posts the
SALE through the existing pipeline (invariant 1).
"""

import logging
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.core.mail import send_mail
from django.db import connection, transaction
from django.db.models import Sum

from apps.catalog.models import ItemVariant
from apps.inventory.models import StockLevel
from apps.storefront import selectors
from apps.storefront.models import StoreCustomer, StoreOrder, StoreOrderItem
from apps.tenants.models import Branch
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.numbering import allocate_number
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.tenants.models import Tenant

logger = logging.getLogger(__name__)

ORDER_DOC_TYPE = "STORE_ORDER"
ORDER_PREFIX = "ORD"


def _line_price(
    variant: ItemVariant,
    *,
    discount_pct: Decimal | None,
    display_currency: str,
    tenant_currency: str,
) -> tuple[Decimal, Decimal | None]:
    """(unit_price, compare_at) for checkout — same rule the grid displays."""
    price, compare_at = selectors.website_price_display(
        variant.item, discount_pct=discount_pct
    )
    if price is not None:
        return price, compare_at
    fallback = variant.min_selling_price or variant.item.min_selling_price
    if fallback is None:
        raise ServiceError(
            "PRICE_NOT_SET",
            f"'{variant.item.name}' does not have an online price yet.",
            http_status=409,
        )
    return (
        selectors.convert_for_display(
            fallback, from_currency=tenant_currency, to_currency=display_currency
        ),
        None,
    )


def _send_confirmation(order: StoreOrder, customer: StoreCustomer) -> None:
    """Best-effort confirmation email — a mail outage must never kill a sale."""
    from django.conf import settings

    tracking_url = (
        f"https://{order.tenant.shopfront_subdomain}.shop.{settings.ROOT_DOMAIN}"
        f"/order/{order.tracking_token}"
    )
    try:
        send_mail(
            subject=f"Order {order.number_text} received — {order.tenant.name}",
            message=(
                f"Namaste {customer.full_name or ''}!\n\n"
                f"We received your order {order.number_text} for "
                f"{order.currency} {order.total}.\n"
                f"Track it here: {tracking_url}\n\n"
                "We will call you to confirm before dispatch.\n"
            ),
            from_email=None,
            recipient_list=[customer.email],
            fail_silently=True,
        )
    except Exception:
        logger.warning("store order confirmation email failed", exc_info=True)


@transaction.atomic
def place_order(
    tenant: "Tenant",
    *,
    customer_fields: dict[str, str],
    fulfillment: str,
    payment_method: str,
    address: dict[str, Any] | None,
    note: str,
    lines: list[dict[str, Any]],
    idempotency_key: str,
) -> tuple[StoreOrder, bool]:
    """Place an order; replays return the original with ``created=False``.

    ``customer_fields`` carries email/full_name/phone — a new email creates
    the customer right here, fulfilling "account on first order".
    """
    existing = StoreOrder.objects.filter(
        tenant=tenant, idempotency_key=idempotency_key
    ).first()
    if existing is not None:
        return existing, False

    store = selectors.get_settings(tenant)
    display_currency = selectors.display_currency(tenant, store)
    discount_pct = store.offer_discount_pct if store else None

    email = customer_fields["email"].strip().lower()
    customer, _ = StoreCustomer.objects.get_or_create(
        tenant=tenant,
        email=email,
        defaults={
            "full_name": customer_fields["full_name"].strip(),
            "phone": customer_fields["phone"].strip(),
        },
    )
    # Keep the profile fresh from the latest order; the order itself snapshots.
    profile_updates: dict[str, Any] = {}
    new_name = customer_fields["full_name"].strip()
    new_phone = customer_fields["phone"].strip()
    if new_name and new_name != customer.full_name:
        profile_updates["full_name"] = new_name
    if new_phone and new_phone != customer.phone:
        profile_updates["phone"] = new_phone
    if fulfillment == StoreOrder.Fulfillment.DELIVERY and address:
        profile_updates["default_address"] = address
    if profile_updates:
        for name, value in profile_updates.items():
            setattr(customer, name, value)
        customer.save(update_fields=[*profile_updates, "updated_at"])

    variant_ids = [line["variant"] for line in lines]
    variants = {
        v.pk: v
        for v in ItemVariant.objects.filter(
            tenant=tenant, pk__in=variant_ids, is_active=True, item__is_active=True
        ).select_related("item")
    }
    missing = [str(v) for v in variant_ids if v not in variants]
    if missing:
        raise ServiceError(
            "VARIANT_NOT_FOUND",
            "Some items in your cart are no longer available — please refresh.",
            http_status=409,
        )

    stock = dict(
        StockLevel.objects.filter(tenant=tenant, variant_id__in=variant_ids)
        .values_list("variant_id")
        .annotate(on_hand=Sum("qty_on_hand"))
    )
    order_lines: list[dict[str, Any]] = []
    subtotal = Decimal("0")
    for line in lines:
        variant = variants[line["variant"]]
        qty = line["qty"]
        on_hand = stock.get(variant.pk) or Decimal("0")
        if on_hand < qty:
            raise ServiceError(
                "OUT_OF_STOCK",
                f"'{variant.item.name}' ({variant.size} / {variant.color}) does not have "
                "enough stock right now.",
                http_status=409,
            )
        unit_price, compare_at = _line_price(
            variant,
            discount_pct=discount_pct,
            display_currency=display_currency,
            tenant_currency=tenant.currency,
        )
        line_total = quantize_money(unit_price * qty)
        subtotal += line_total
        order_lines.append(
            {
                "variant": variant,
                "unit_price": unit_price,
                "compare_at": compare_at,
                "qty": qty,
                "line_total": line_total,
            }
        )

    branch = Branch.objects.filter(tenant=tenant, is_default=True).first()
    if branch is None:
        raise ServiceError(
            "SHOP_NOT_READY", "This store is not ready to take orders yet.", http_status=409
        )
    today = date.today()
    fiscal_year = fiscal_year_bs(today)
    number = allocate_number(
        connection,
        tenant_id=tenant.pk,
        branch_id=branch.pk,
        doc_type=ORDER_DOC_TYPE,
        fiscal_year_bs=fiscal_year,
        prefix=ORDER_PREFIX,
    )
    order = StoreOrder.objects.create(
        tenant=tenant,
        branch=branch,
        customer=customer,
        order_number=number,
        number_text=f"{ORDER_PREFIX}-{number:06d}",
        fulfillment=fulfillment,
        payment_method=payment_method,
        address=address if fulfillment == StoreOrder.Fulfillment.DELIVERY else None,
        currency=display_currency,
        subtotal=subtotal,
        total=subtotal,
        offer_text=store.offer_text if store and discount_pct else "",
        idempotency_key=idempotency_key,
        note=note,
        business_date_ad=today,
        business_date_bs=ad_to_bs(today),
        fiscal_year_bs=fiscal_year,
    )
    StoreOrderItem.objects.bulk_create(
        [
            StoreOrderItem(
                tenant=tenant,
                order=order,
                variant=line["variant"],
                name=line["variant"].item.name,
                size=line["variant"].size,
                color=line["variant"].color,
                unit_price=line["unit_price"],
                compare_at=line["compare_at"],
                qty=line["qty"],
                line_total=line["line_total"],
            )
            for line in order_lines
        ]
    )
    _send_confirmation(order, customer)
    return order, True
