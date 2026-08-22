"""Read-side queries for catalog; every selector takes an explicit ``user``.

Cost-visibility rule (ARCHITECTURE §6 invariant 10, design §4.6): ``avg_cost`` is
dropped AT THE SELECTOR for users without ``pricing.view_cost`` — it never
enters application memory for them, on success or error paths.
"""

from typing import TYPE_CHECKING, Any
from uuid import UUID

from django.conf import settings
from django.db.models import Count, Max, Min, Q, QuerySet

from apps.catalog.models import Brand, Category, Item, ItemVariant, SizeChart

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_LOOKUP_PUBLIC_FIELDS = (
    "id",
    "sku",
    "barcode",
    "size",
    "color",
    "color_hex",
    "mrp",
    "is_active",
    "item__name",
    "item__name_np",
    "item__code",
)


def list_categories(
    tenant: "Tenant", user: "User", *, is_active: bool | None = None, search: str = ""
) -> QuerySet[Category]:
    qs = Category.objects.filter(tenant=tenant).select_related("parent", "size_chart")
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    if search:
        qs = qs.filter(name__icontains=search)
    return qs.order_by("sort_order", "name")


def list_brands(
    tenant: "Tenant", user: "User", *, is_active: bool | None = None, search: str = ""
) -> QuerySet[Brand]:
    qs = Brand.objects.filter(tenant=tenant)
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    if search:
        qs = qs.filter(name__icontains=search)
    return qs.order_by("name")


def list_size_charts(tenant: "Tenant", user: "User") -> QuerySet[SizeChart]:
    return SizeChart.objects.filter(tenant=tenant).order_by("name")


def list_items(
    tenant: "Tenant",
    user: "User",
    *,
    category_id: UUID | None = None,
    brand_id: UUID | None = None,
    is_active: bool | None = None,
    search: str = "",
) -> QuerySet[Item]:
    qs = (
        Item.objects.filter(tenant=tenant)
        .select_related("category", "brand", "size_chart")
        # Card-grid display annotations: active-variant count and MRP range.
        # MRP is a selling price (never cost), so these are safe for every
        # catalog.view user.
        .annotate(
            variants_count=Count("variants", filter=Q(variants__is_active=True)),
            mrp_min=Min("variants__mrp", filter=Q(variants__is_active=True)),
            mrp_max=Max("variants__mrp", filter=Q(variants__is_active=True)),
        )
    )
    if category_id:
        qs = qs.filter(category_id=category_id)
    if brand_id:
        qs = qs.filter(brand_id=brand_id)
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    if search:
        qs = qs.filter(name__icontains=search) | qs.filter(code__icontains=search)
    return qs.order_by("code")


def list_variants(
    tenant: "Tenant",
    user: "User",
    *,
    item_id: UUID | None = None,
    is_active: bool | None = None,
) -> QuerySet[ItemVariant]:
    qs = ItemVariant.objects.filter(tenant=tenant).select_related("item")
    if item_id:
        qs = qs.filter(item_id=item_id)
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    return qs.order_by("item__code", "size", "color")


def get_variant_for_lookup(
    tenant: "Tenant", user: "User", *, barcode: str = "", sku: str = ""
) -> dict[str, Any] | None:
    """POS hot path: one indexed exact-match query by barcode or SKU.

    Returns a plain dict (no ORM instance) containing only the fields the
    caller may see: ``avg_cost`` is only included — and only selected — when
    the user has ``pricing.view_cost``.
    """
    fields = [*_LOOKUP_PUBLIC_FIELDS, "item__image"]
    include_cost = user.has_perm("pricing.view_cost")
    if include_cost:
        fields.append("avg_cost")
    qs = ItemVariant.objects.filter(tenant=tenant)
    if barcode:
        qs = qs.filter(barcode=barcode)
    elif sku:
        qs = qs.filter(sku=sku)
    else:
        return None
    row = qs.values(*fields).first()
    if row is not None:
        # The scan/exchange pickers show a thumbnail; expose the item photo
        # as a public media URL (MEDIA_URL + storage key), never a fs path.
        image_key = row.pop("item__image")
        row["image_url"] = f"{settings.MEDIA_URL}{image_key}" if image_key else None
    if row is not None and include_cost:
        # Money crosses the API as a string, matching DRF's serializer
        # coercion (COERCE_DECIMAL_TO_STRING) — never as a JSON float.
        row["avg_cost"] = str(row["avg_cost"])
    return row


def list_variants_for_sale(
    tenant: "Tenant", user: "User", *, branch_id: UUID, search: str = ""
) -> list[dict[str, Any]]:
    """POS dropdown rows: variants with stock on hand at one branch.

    Only rows with ``qty_on_hand > 0`` are sellable right now. Price bounds
    come from the pricing chain (variant → item → category pct-of-MRP);
    either side is None when unset. Cost NEVER appears here (#10): the
    selector reads no cost column and the bounds chain is MRP/selling-price
    based. Money crosses the API as strings, never JSON floats. ``image_url``
    is the item's media URL path (or None) so the picker can show thumbnails.
    """
    from apps.inventory.models import StockLevel
    from apps.pricing.services import effective_price_bounds

    del user  # the route permission (sale.create) already gated this read
    qs = (
        StockLevel.objects.filter(tenant=tenant, branch_id=branch_id, qty_on_hand__gt=0)
        .select_related("variant", "variant__item", "variant__item__category")
        .order_by("variant__item__name", "variant__size", "variant__color")
    )
    if search:
        qs = qs.filter(
            Q(variant__item__name__icontains=search)
            | Q(variant__sku__icontains=search)
            | Q(variant__barcode__icontains=search)
        )
    rows: list[dict[str, Any]] = []
    for level in qs:
        variant = level.variant
        min_price, max_price = effective_price_bounds(tenant, variant=variant)
        rows.append(
            {
                "id": str(variant.pk),
                "item": str(variant.item_id),
                "item_name": variant.item.name,
                "size": variant.size,
                "color": variant.color,
                "sku": variant.sku,
                "barcode": variant.barcode,
                "mrp": str(variant.mrp) if variant.mrp is not None else None,
                "image_url": variant.item.image.url if variant.item.image else None,
                "qty_on_hand": str(level.qty_on_hand),
                "min_selling_price": str(min_price) if min_price is not None else None,
                "max_selling_price": str(max_price) if max_price is not None else None,
            }
        )
    return rows
