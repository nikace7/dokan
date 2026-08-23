"""Read-side queries for pricing; every selector takes an explicit ``user``.

No cost columns exist on these tables, so nothing to drop — but the
explicit-user convention is kept for consistency (design §8.1).
"""

from typing import TYPE_CHECKING, Any
from uuid import UUID

from django.db.models import QuerySet

from apps.catalog.models import Category, Item, ItemVariant
from apps.pricing.models import ItemPrice, PriceChangeLog, RateType

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def variant_label(variant: Any) -> str:
    """'Item name · SKU' — the one readable form of a variant everywhere."""
    return f"{variant.item.name} · {variant.sku}"


def item_price_target_label(price: ItemPrice) -> str | None:
    """Human-readable target of a scoped price; FKs are select_related."""
    if price.scope == ItemPrice.Scope.VARIANT and price.variant is not None:
        return variant_label(price.variant)
    if price.scope == ItemPrice.Scope.ITEM and price.item is not None:
        return price.item.name
    if price.scope == ItemPrice.Scope.CATEGORY and price.category is not None:
        return price.category.name
    return None


def price_change_target_labels(
    tenant: "Tenant", changes: list[PriceChangeLog]
) -> dict[tuple[str, str], str]:
    """Names for change-log targets, bulk-fetched per type (no N+1)."""
    ids: dict[str, set[UUID]] = {"VARIANT": set(), "ITEM": set(), "CATEGORY": set()}
    for change in changes:
        if change.target_type in ids:
            ids[change.target_type].add(change.target_id)
    labels: dict[tuple[str, str], str] = {}
    variants = ItemVariant.objects.filter(tenant=tenant, pk__in=ids["VARIANT"]).select_related(
        "item"
    )
    for variant in variants:
        labels[("VARIANT", str(variant.pk))] = variant_label(variant)
    for item in Item.objects.filter(tenant=tenant, pk__in=ids["ITEM"]):
        labels[("ITEM", str(item.pk))] = item.name
    for category in Category.objects.filter(tenant=tenant, pk__in=ids["CATEGORY"]):
        labels[("CATEGORY", str(category.pk))] = category.name
    return labels


def list_rate_types(
    tenant: "Tenant", user: "User", *, is_active: bool | None = None
) -> QuerySet[RateType]:
    qs = RateType.objects.filter(tenant=tenant).select_related("required_permission")
    if is_active is not None:
        qs = qs.filter(is_active=is_active)
    return qs.order_by("sort_order", "code")


def list_prices(
    tenant: "Tenant",
    user: "User",
    *,
    rate_type_id: UUID | None = None,
    scope: str = "",
) -> QuerySet[ItemPrice]:
    qs = ItemPrice.objects.filter(tenant=tenant).select_related(
        "rate_type", "variant__item", "item", "category"
    )
    if rate_type_id:
        qs = qs.filter(rate_type_id=rate_type_id)
    if scope:
        qs = qs.filter(scope=scope)
    return qs.order_by("scope", "-effective_from")


def list_price_changes(
    tenant: "Tenant",
    user: "User",
    *,
    target_type: str = "",
    target_id: UUID | None = None,
) -> QuerySet[PriceChangeLog]:
    qs = PriceChangeLog.objects.filter(tenant=tenant).select_related("rate_type", "changed_by")
    if target_type:
        qs = qs.filter(target_type=target_type)
    if target_id:
        qs = qs.filter(target_id=target_id)
    return qs.order_by("-created_at")
