"""Read-side queries for the public storefront.

Every query here runs inside an RLS tenant context opened by the view
(``set_local_tenant``). Nothing in this module may expose cost figures,
exact stock quantities, or inactive catalog rows — the storefront shows
selling-price ranges and an in/out-of-stock boolean only.
"""

from decimal import Decimal

from django.db.models import Count, Exists, OuterRef, Q, QuerySet

from apps.catalog.models import Category, Item
from apps.inventory.models import StockLevel
from apps.storefront.models import StoreSettings
from apps.tenants.models import Tenant
from core.money import CURRENCY_INR, NPR_PER_INR, quantize_money


def extract_shopfront_label(host: str, root_domain: str) -> str | None:
    """'yak.shop.mero-pasal.online' → 'yak'; None for any non-shopfront host."""
    hostname = host.split(":", 1)[0].lower().rstrip(".")
    suffix = f".shop.{root_domain.lower()}"
    if not hostname.endswith(suffix):
        return None
    label = hostname[: -len(suffix)]
    return label if label and "." not in label else None


def get_tenant_by_shopfront(label: str) -> Tenant | None:
    return Tenant.objects.filter(shopfront_subdomain=label).select_related("plan").first()


def get_settings(tenant: Tenant) -> StoreSettings | None:
    """The tenant's store settings row, or None when never configured."""
    return StoreSettings.objects.filter(tenant=tenant).first()


def display_currency(tenant: Tenant, settings_row: StoreSettings | None) -> str:
    """Currency the storefront displays: the configured website currency wins."""
    return settings_row.currency if settings_row else tenant.currency


def convert_for_display(amount: Decimal, *, from_currency: str, to_currency: str) -> Decimal:
    """Convert a money amount at the NPR/INR peg — display only, never stored."""
    if from_currency == to_currency:
        return amount
    if from_currency == CURRENCY_INR:  # INR → NPR
        return quantize_money(amount * NPR_PER_INR)
    return quantize_money(amount / NPR_PER_INR)  # NPR → INR


def website_price_display(
    item: Item, *, discount_pct: Decimal | None
) -> tuple[Decimal | None, Decimal | None]:
    """(price, compare_at) for the public grid from the item's website price.

    The website price is entered in the store's display currency, so no peg
    conversion applies. An active store-wide offer discounts it and exposes
    the original as ``compare_at`` for the strike-through; without a website
    price both come back None and the template falls back to the range.
    """
    if item.website_price is None:
        return None, None
    price = quantize_money(item.website_price)
    if discount_pct is not None and discount_pct > 0:
        discounted = quantize_money(price * (Decimal(100) - discount_pct) / Decimal(100))
        return discounted, price
    return price, None


def public_categories(tenant: Tenant) -> QuerySet[Category]:
    """Active categories with their visible product count for the shop nav."""
    return (
        Category.objects.filter(tenant=tenant, is_active=True)
        .annotate(product_count=Count("items", filter=Q(items__is_active=True)))
        .order_by("sort_order", "name")
    )


def public_products(
    tenant: Tenant, *, category_id: str | None = None, q: str | None = None
) -> QuerySet[Item]:
    """Active items for the public grid. Stock exposure stays a boolean."""
    in_stock = StockLevel.objects.filter(
        tenant=tenant, variant__item=OuterRef("pk"), qty_on_hand__gt=0
    )
    items = (
        Item.objects.filter(tenant=tenant, is_active=True)
        .select_related("category", "brand")
        .annotate(in_stock=Exists(in_stock))
        .order_by("name")
    )
    if category_id:
        items = items.filter(category_id=category_id)
    if q:
        items = items.filter(name__icontains=q)
    return items
