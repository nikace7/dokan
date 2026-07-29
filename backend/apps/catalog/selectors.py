"""Read-side queries for catalog; every selector takes an explicit ``user``.

Cost-visibility rule (AGENTS.md invariant 10, design §4.6): ``avg_cost`` is
dropped AT THE SELECTOR for users without ``pricing.view_cost`` — it never
enters application memory for them, on success or error paths.
"""

from typing import TYPE_CHECKING, Any
from uuid import UUID

from django.db.models import QuerySet

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
    qs = Item.objects.filter(tenant=tenant).select_related("category", "brand", "size_chart")
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
    fields = list(_LOOKUP_PUBLIC_FIELDS)
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
    if row is not None and include_cost:
        # Money crosses the API as a string, matching DRF's serializer
        # coercion (COERCE_DECIMAL_TO_STRING) — never as a JSON float.
        row["avg_cost"] = str(row["avg_cost"])
    return row
