"""Quick product creation — item + size×colour matrix + opening stock, one transaction.

Backs the simplified one-page "Add product" flow: a single POST that does
what the catalog screens otherwise do in three steps. Composes
``services.create_item`` / ``services.bulk_create_variants`` with
``inventory.services.post_opening_stock``; their inner atomic blocks become
savepoints under the outer transaction, so any failure rolls back everything
(no half-created products).

Import direction: this module may import ``apps.inventory.services`` and
``apps.catalog.services``; ``apps.catalog.services`` must never import this
module (inventory already depends on catalog models — no cycle).
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import transaction

from apps.catalog import services
from apps.inventory.services import post_opening_stock
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.catalog.models import ItemVariant
    from apps.tenants.models import Branch, Tenant

_QUANTITY_KEY_SEP = "::"  # "<size>::<colour>" — mirrors the frontend matrix keys


def _parse_quantity_rows(
    stock_rows: dict[str, Decimal], sizes: list[str], colors: list[str]
) -> dict[tuple[str, str], Decimal]:
    """Validate ``<size>::<colour>`` keys against the submitted matrix."""
    valid = {(size, color) for size in sizes for color in colors}
    parsed: dict[tuple[str, str], Decimal] = {}
    for key, qty in stock_rows.items():
        size, sep, color = key.partition(_QUANTITY_KEY_SEP)
        if not sep or (size, color) not in valid:
            raise ServiceError(
                "QUANTITY_KEY_INVALID",
                f"Stock quantity key '{key}' is not a '<size>::<colour>' pair "
                "from the submitted sizes and colours.",
            )
        parsed[(size, color)] = qty
    return parsed


@transaction.atomic
def quick_create_product(
    tenant: "Tenant",
    *,
    created_by: "User",
    sizes: list[str],
    colors: list[str],
    mrp: Decimal | None = None,
    branch: "Branch | None" = None,
    stock_rows: dict[str, Decimal] | None = None,
    unit_cost: Decimal | None = None,
    note: str = "",
    **item_fields: Any,
) -> dict[str, Any]:
    """Create an item, its variant matrix, and optionally opening stock.

    ``stock_rows`` maps ``"<size>::<colour>"`` to a quantity; every key must
    be a pair from the submitted ``sizes`` × ``colors``. Quantities are
    validated by :func:`post_opening_stock` (qty > 0, cost ≥ 0) — any failure
    aborts the whole creation.
    """
    parsed_rows = _parse_quantity_rows(stock_rows or {}, sizes, colors)
    if parsed_rows and branch is None:
        raise ServiceError("BRANCH_REQUIRED", "Opening stock requires a branch.")
    if parsed_rows and unit_cost is None:
        raise ServiceError("COST_INVALID", "Opening stock requires a unit cost.")

    item = services.create_item(tenant, created_by=created_by, **item_fields)
    matrix = services.bulk_create_variants(tenant, item=item, sizes=sizes, colors=colors, mrp=mrp)

    movements = 0
    if parsed_rows and branch is not None and unit_cost is not None:
        by_combo = {(v.size, v.color): v for v in matrix["created"]}
        for combo, qty in parsed_rows.items():
            variant: ItemVariant | None = by_combo.get(combo)
            if variant is None:
                # Combination already existed (skipped by the matrix); opening
                # stock for it belongs in the inventory flow, not here.
                continue
            post_opening_stock(
                tenant,
                branch=branch,
                variant=variant,
                qty=qty,
                unit_cost=unit_cost,
                created_by=created_by,
                note=note,
            )
            movements += 1

    return {
        "item": item,
        "variants": matrix["created"],
        "variants_created": matrix["created_count"],
        "stock_movements": movements,
    }
