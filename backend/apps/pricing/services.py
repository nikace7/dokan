"""Pricing services — resolution chain, guardrails, price writes, rate types.

Money-critical module: 100% coverage required (AGENTS.md).

Resolution chain (docs/SYSTEM_DESIGN.md §4.2, deterministic, first hit wins):
    VARIANT-scope price → ITEM-scope → CATEGORY-scope (nearest ancestor
    first) → variant.mrp → 409 PRICE_NOT_SET.

Two deliberate deviations from §4.2/§4.3, decided for this slice:
- Fallback is ``variant.mrp``, NOT the cost-derived price
  (``avg_cost × (1 + margin)``): resolution runs for users without
  ``pricing.view_cost``, and a cost-derived result would disclose cost.
- Category bounds are ``min_price_pct``/``max_price_pct`` **of MRP**, not of
  cost, for the same reason — a cost-derived bound leaks cost into billing
  error paths for cashiers (invariant 10).

Dates (§4.2): a price is active on ``d`` when
``effective_from <= d AND (effective_to IS NULL OR effective_to >= d)``;
ties break by most recent ``effective_from``.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, transaction
from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.audit.services import audit
from apps.catalog.models import Category, Item, ItemVariant
from apps.pricing.models import ItemPrice, PriceChangeLog, RateType
from apps.tenants.services import enforce_creation_limit, require_plan_feature
from core.money import format_npr, quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


@dataclass(frozen=True)
class PriceResolution:
    """Structured result of the resolution chain. Never carries cost."""

    price: Decimal
    source: str  # VARIANT | ITEM | CATEGORY | MRP
    item_price: ItemPrice | None  # None for the MRP fallback


def _active_prices(
    tenant: "Tenant", rate_type: RateType, scope: str, on: date
) -> QuerySet[ItemPrice]:
    """Effective-dated prices at one scope, most recent effective_from first."""
    return (
        ItemPrice.objects.filter(tenant=tenant, rate_type=rate_type, scope=scope)
        .filter(effective_from__lte=on)
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=on))
        .order_by("-effective_from", "-created_at")
    )


def _assert_rate_allowed(rate_type: RateType, user: "User") -> None:
    """Restricted rate types require their permission codename (§4.5)."""
    if rate_type.required_permission_id and not user.has_perm(
        str(rate_type.required_permission_id)
    ):
        raise ServiceError(
            "PRICING_RATE_FORBIDDEN",
            "You are not allowed to use this rate type.",
            http_status=403,
        )


def resolve_price(
    tenant: "Tenant",
    *,
    variant: ItemVariant,
    rate_type: RateType,
    on_date: date | None = None,
    user: "User",
) -> PriceResolution:
    """Resolve the selling price for a variant at a rate type (§4.2 chain)."""
    _assert_rate_allowed(rate_type, user)
    on = on_date or timezone.localdate()

    variant_price = _active_prices(tenant, rate_type, "VARIANT", on).filter(variant=variant).first()
    if variant_price is not None:
        return PriceResolution(variant_price.price, "VARIANT", variant_price)

    item_price = (
        _active_prices(tenant, rate_type, "ITEM", on).filter(item_id=variant.item_id).first()
    )
    if item_price is not None:
        return PriceResolution(item_price.price, "ITEM", item_price)

    category = variant.item.category
    while category is not None:
        category_price = (
            _active_prices(tenant, rate_type, "CATEGORY", on).filter(category=category).first()
        )
        if category_price is not None:
            return PriceResolution(category_price.price, "CATEGORY", category_price)
        category = category.parent

    if variant.mrp is not None:
        return PriceResolution(variant.mrp, "MRP", None)

    raise ServiceError(
        "PRICE_NOT_SET",
        "No price is set for this item at this rate. Set a price first.",
        http_status=409,
    )


# --- Guardrails (§4.3) --------------------------------------------------------


def effective_price_bounds(
    tenant: "Tenant", *, variant: ItemVariant
) -> tuple[Decimal | None, Decimal | None]:
    """Effective (min, max): variant override → item → category pct-of-MRP, walking up."""
    min_price = variant.min_selling_price
    max_price = variant.max_selling_price
    item = variant.item
    if min_price is None:
        min_price = item.min_selling_price
    if max_price is None:
        max_price = item.max_selling_price

    category = item.category
    while category is not None and (min_price is None or max_price is None):
        if variant.mrp is not None:
            if min_price is None and category.min_price_pct is not None:
                min_price = quantize_money(variant.mrp * category.min_price_pct / 100)
            if max_price is None and category.max_price_pct is not None:
                max_price = quantize_money(variant.mrp * category.max_price_pct / 100)
        category = category.parent
    return min_price, max_price


def assert_price_within_bounds(
    tenant: "Tenant",
    *,
    variant: ItemVariant,
    price: Decimal,
    user: "User",
    reason: str = "",
) -> None:
    """Enforce the min/max guardrails (§4.3).

    Above-max: always rejected. Below-min: allowed only with
    ``pricing.override_min`` AND a required reason (the invoice-time audit
    log and review flag land with the sales app). Messages disclose the
    selling-price bound (allowed per §4.3) but never any cost figure.
    """
    min_price, max_price = effective_price_bounds(tenant, variant=variant)

    if max_price is not None and price > max_price:
        raise ServiceError(
            "PRICE_ABOVE_MAX",
            f"Above the maximum selling price ({format_npr(max_price)}).",
        )
    if min_price is not None and price < min_price:
        if not user.has_perm("pricing.override_min"):
            raise ServiceError(
                "PRICE_BELOW_MIN",
                f"Below the minimum selling price ({format_npr(min_price)}).",
            )
        if not reason.strip():
            raise ServiceError(
                "OVERRIDE_REASON_REQUIRED",
                "A reason is required to sell below the minimum price.",
            )


def set_price_bounds(
    *,
    target: ItemVariant | Item,
    min_selling_price: Decimal | None,
    max_selling_price: Decimal | None,
    user: "User",
) -> None:
    """Change min/max bounds on an item or variant (pricing.set_bounds gate
    is enforced at the view layer)."""
    if (
        min_selling_price is not None
        and max_selling_price is not None
        and min_selling_price > max_selling_price
    ):
        raise ServiceError(
            "PRICE_BOUNDS_INVALID",
            "Minimum selling price cannot be higher than maximum selling price.",
        )
    before = {
        "min_selling_price": (
            str(target.min_selling_price) if target.min_selling_price is not None else None
        ),
        "max_selling_price": (
            str(target.max_selling_price) if target.max_selling_price is not None else None
        ),
    }
    target.min_selling_price = min_selling_price
    target.max_selling_price = max_selling_price
    target.save(update_fields=["min_selling_price", "max_selling_price", "updated_at"])
    audit(
        target.tenant,
        actor=user,
        action="price.set_bounds",
        target_type=type(target).__name__.lower(),
        target_id=target,
        before=before,
        after={
            "min_selling_price": (
                str(min_selling_price) if min_selling_price is not None else None
            ),
            "max_selling_price": (
                str(max_selling_price) if max_selling_price is not None else None
            ),
        },
    )


# --- Price writes -------------------------------------------------------------

_SCOPE_FKS = {"VARIANT": "variant", "ITEM": "item", "CATEGORY": "category"}


def _scope_target(scope: str, **fks: Any) -> Any:
    """Validate exactly-one-scope-FK and return (fk_field, target)."""
    fk_field = _SCOPE_FKS.get(scope)
    if fk_field is None:
        raise ServiceError("SCOPE_INVALID", "Scope must be VARIANT, ITEM, or CATEGORY.")
    target = fks.get(fk_field)
    if target is None:
        raise ServiceError("SCOPE_TARGET_REQUIRED", f"Scope {scope} requires a {fk_field}.")
    return target


def set_price(
    tenant: "Tenant",
    *,
    rate_type: RateType,
    scope: str,
    price: Decimal,
    effective_from: date,
    effective_to: date | None = None,
    created_by: "User",
    reason: str = "",
    variant: ItemVariant | None = None,
    item: Item | None = None,
    category: Category | None = None,
) -> ItemPrice:
    """Create (or replace, for the same scope+rate+date) an ItemPrice.

    Writes the PriceChangeLog row in the SAME transaction: old_price is the
    price currently effective at that scope on effective_from (or None).
    """
    price = Decimal(price)
    if price <= 0:
        raise ServiceError("PRICE_INVALID", "Price must be greater than zero.")
    if effective_to is not None and effective_to < effective_from:
        raise ServiceError("DATE_RANGE_INVALID", "effective_to cannot be before effective_from.")
    target = _scope_target(scope, variant=variant, item=item, category=category)
    fk_field = _SCOPE_FKS[scope]

    on = effective_from
    current = _active_prices(tenant, rate_type, scope, on).filter(**{fk_field: target}).first()
    old_price = current.price if current is not None else None

    with transaction.atomic():
        existing = ItemPrice.objects.filter(
            tenant=tenant,
            rate_type=rate_type,
            scope=scope,
            effective_from=effective_from,
            **{fk_field: target},
        ).first()
        if existing is not None:
            existing.price = price
            existing.effective_to = effective_to
            existing.created_by = created_by
            existing.save(update_fields=["price", "effective_to", "created_by", "updated_at"])
            item_price = existing
        else:
            item_price = ItemPrice.objects.create(
                tenant=tenant,
                rate_type=rate_type,
                scope=scope,
                price=price,
                effective_from=effective_from,
                effective_to=effective_to,
                created_by=created_by,
                **{fk_field: target},
            )
        PriceChangeLog.objects.create(
            tenant=tenant,
            target_type=scope,
            target_id=target.pk,
            rate_type=rate_type,
            old_price=old_price,
            new_price=price,
            changed_by=created_by,
            reason=reason or None,
        )
        audit(
            tenant,
            actor=created_by,
            action="price.set",
            target_type="item_price",
            target_id=item_price,
            before={"price": str(old_price) if old_price is not None else None},
            after={
                "price": str(price),
                "scope": scope,
                "rate_type": rate_type.code,
                "target_id": str(target.pk),
            },
        )
    return item_price


# --- Rate types ---------------------------------------------------------------


def create_rate_type(tenant: "Tenant", *, user: "User", **fields: Any) -> RateType:
    """Create a rate type; exactly one default per tenant (§4.5)."""
    with transaction.atomic():
        require_plan_feature(tenant, "custom_rate_types")
        enforce_creation_limit(
            tenant,
            key="max_rate_types",
            namespace="features",
            queryset=RateType.objects.filter(tenant=tenant, is_active=True),
            label="active rate types",
        )
        if fields.get("required_permission"):
            fields["required_permission"] = _get_permission(fields["required_permission"])
        is_default = bool(fields.get("is_default"))
        if is_default:
            _unset_default(tenant)
        rate_type = RateType(tenant=tenant, **fields)
        try:
            rate_type.save()
        except IntegrityError as exc:
            if "rate_type_tenant_code_uniq" in str(exc):
                raise ServiceError(
                    "ALREADY_EXISTS", "A rate type with this code already exists."
                ) from exc
            raise
    return rate_type


def update_rate_type(tenant: "Tenant", rate_type: RateType, **fields: Any) -> RateType:
    """Update a rate type; making it default unsets the previous default."""
    if fields.get("required_permission"):
        fields["required_permission"] = _get_permission(fields["required_permission"])
    with transaction.atomic():
        if fields.get("is_default") and not rate_type.is_default:
            _unset_default(tenant)
        for name, value in fields.items():
            setattr(rate_type, name, value)
        try:
            rate_type.save()
        except IntegrityError as exc:
            if "rate_type_tenant_code_uniq" in str(exc):
                raise ServiceError(
                    "ALREADY_EXISTS", "A rate type with this code already exists."
                ) from exc
            raise
    return rate_type


def deactivate_rate_type(rate_type: RateType) -> RateType:
    """Soft-delete only: historical invoices reference rate types (§4.5)."""
    if rate_type.is_default:
        raise ServiceError("RATE_TYPE_IN_USE", "The default rate type cannot be deactivated.")
    rate_type.is_active = False
    rate_type.save(update_fields=["is_active", "updated_at"])
    return rate_type


def get_default_rate_type(tenant: "Tenant") -> RateType:
    """The tenant's default rate type (used when resolve is called without one)."""
    rate_type = RateType.objects.filter(tenant=tenant, is_default=True, is_active=True).first()
    if rate_type is None:
        raise ServiceError(
            "RATE_TYPE_NOT_FOUND", "No default rate type is configured.", http_status=404
        )
    return rate_type


def _unset_default(tenant: "Tenant") -> None:
    RateType.objects.filter(tenant=tenant, is_default=True).update(is_default=False)


def _get_permission(code: Any) -> Any:
    """Resolve a required_permission codename to its catalog row."""
    from apps.accounts.models import Permission

    permission = Permission.objects.filter(code=str(code)).first()
    if permission is None:
        raise ServiceError(
            "PERMISSION_NOT_FOUND", f"Unknown permission codename: {code}.", http_status=400
        )
    return permission
