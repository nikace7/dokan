"""Read-side queries for inventory; every selector takes an explicit ``user``.

Cost-visibility rule (AGENTS.md invariant 10): ``avg_cost`` / ``unit_cost``
are deferred AT THE QUERYSET for users without ``pricing.view_cost`` — the
columns never enter application memory for them.
"""

from datetime import date
from typing import TYPE_CHECKING
from uuid import UUID

from django.db.models import QuerySet

from apps.inventory.models import StockLevel, StockMovement

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def list_levels(
    tenant: "Tenant",
    user: "User",
    *,
    branch_id: UUID | None = None,
    variant_id: UUID | None = None,
    item_id: UUID | None = None,
    search: str = "",
) -> QuerySet[StockLevel]:
    """Stock levels with branch/variant/item filters and name/SKU search."""
    qs = StockLevel.objects.filter(tenant=tenant).select_related(
        "branch", "variant", "variant__item"
    )
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    if variant_id:
        qs = qs.filter(variant_id=variant_id)
    if item_id:
        qs = qs.filter(variant__item_id=item_id)
    if search:
        qs = (
            qs.filter(variant__sku__icontains=search)
            | qs.filter(variant__item__name__icontains=search)
        ).distinct()
    if not user.has_perm("pricing.view_cost"):
        qs = qs.defer("avg_cost")
    return qs.order_by("variant__sku", "branch__code")


def list_movements(
    tenant: "Tenant",
    user: "User",
    *,
    branch_id: UUID | None = None,
    variant_id: UUID | None = None,
    movement_type: str = "",
    date_from: date | None = None,
    date_to: date | None = None,
) -> QuerySet[StockMovement]:
    """The ledger. Date filters are AD ISO in; BS fields are denormalized out."""
    qs = StockMovement.objects.filter(tenant=tenant).select_related(
        "branch", "variant", "variant__item", "created_by"
    )
    if branch_id:
        qs = qs.filter(branch_id=branch_id)
    if variant_id:
        qs = qs.filter(variant_id=variant_id)
    if movement_type:
        qs = qs.filter(type=movement_type)
    if date_from:
        qs = qs.filter(business_date_ad__gte=date_from)
    if date_to:
        qs = qs.filter(business_date_ad__lte=date_to)
    if not user.has_perm("pricing.view_cost"):
        qs = qs.defer("unit_cost")
    return qs.order_by("-created_at")
