"""Read-side queries for the public storefront.

Every query here runs inside an RLS tenant context opened by the view
(``set_local_tenant``). Nothing in this module may expose cost figures,
exact stock quantities, or inactive catalog rows — the storefront shows
selling-price ranges and an in/out-of-stock boolean only.
"""

from decimal import Decimal

from django.db.models import Count, Exists, OuterRef, Q, QuerySet
from django.utils import timezone

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
    conversion applies. A live offer discounts it and exposes the original as
    ``compare_at`` for the strike-through; without a website price both come
    back None and the template falls back to the range.
    """
    if item.website_price is None:
        return None, None
    price = quantize_money(item.website_price)
    if discount_pct is not None and discount_pct > 0:
        discounted = quantize_money(price * (Decimal(100) - discount_pct) / Decimal(100))
        return discounted, price
    return price, None


def offer_is_live(settings_row: StoreSettings | None) -> bool:
    """A store-wide offer runs until the end of its ``offer_ends_at`` day."""
    if settings_row is None:
        return False
    return settings_row.offer_ends_at is None or settings_row.offer_ends_at >= timezone.localdate()


def store_offer_pct(settings_row: StoreSettings | None) -> Decimal | None:
    """The store-wide offer percentage while it is live, else None."""
    if settings_row is None or not offer_is_live(settings_row):
        return None
    pct = settings_row.offer_discount_pct
    return pct if pct is not None and pct > 0 else None


def effective_offer_pct(item: Item, settings_row: StoreSettings | None) -> Decimal | None:
    """The discount that applies to one product: a per-product offer beats
    the store-wide one; a lapsed store offer applies to nothing."""
    pct = item.website_discount_pct
    if pct is not None and pct > 0:
        return pct
    return store_offer_pct(settings_row)


def website_pricing(
    item: Item, settings_row: StoreSettings | None
) -> tuple[Decimal | None, Decimal | None, Decimal | None]:
    """(price, compare_at, applied pct) — the one canonical online-price rule,
    shared by the grid, the product detail, and checkout."""
    pct = effective_offer_pct(item, settings_row)
    price, compare_at = website_price_display(item, discount_pct=pct)
    if price is None:
        return None, None, None
    return price, compare_at, pct if compare_at is not None else None


def public_categories(tenant: Tenant) -> QuerySet[Category]:
    """Active categories with their visible product count for the shop nav."""
    return (
        Category.objects.filter(tenant=tenant, is_active=True)
        .annotate(
            product_count=Count(
                "items", filter=Q(items__is_active=True, items__website_visible=True)
            )
        )
        .order_by("sort_order", "name")
    )


def public_products(
    tenant: Tenant,
    *,
    category_id: str | None = None,
    q: str | None = None,
    featured: bool = False,
) -> QuerySet[Item]:
    """Website-visible active items for the public grid. Stock exposure stays
    a boolean; featured products surface first, and ``featured=True`` narrows
    the feed to the storefront rail."""
    in_stock = StockLevel.objects.filter(
        tenant=tenant, variant__item=OuterRef("pk"), qty_on_hand__gt=0
    )
    items = (
        Item.objects.filter(tenant=tenant, is_active=True, website_visible=True)
        .select_related("category", "brand")
        .annotate(in_stock=Exists(in_stock))
        .order_by("-website_featured", "name")
    )
    if featured:
        items = items.filter(website_featured=True)
    if category_id:
        items = items.filter(category_id=category_id)
    if q:
        items = items.filter(name__icontains=q)
    return items
