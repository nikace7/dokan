"""Read-side queries for the public storefront.

Every query here runs inside an RLS tenant context opened by the view
(``set_local_tenant``). Nothing in this module may expose cost figures,
exact stock quantities, or inactive catalog rows — the storefront shows
selling-price ranges and an in/out-of-stock boolean only.
"""

from django.db.models import Count, Exists, OuterRef, Q, QuerySet

from apps.catalog.models import Category, Item
from apps.inventory.models import StockLevel
from apps.tenants.models import Tenant


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
