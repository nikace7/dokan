"""Read-side queries for pricing; every selector takes an explicit ``user``.

No cost columns exist on these tables, so nothing to drop — but the
explicit-user convention is kept for consistency (design §8.1).
"""

from typing import TYPE_CHECKING
from uuid import UUID

from django.db.models import QuerySet

from apps.pricing.models import ItemPrice, PriceChangeLog, RateType

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


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
        "rate_type", "variant", "item", "category"
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
