# 0005. Price resolution and guardrails never derive from cost

**Status:** Accepted
**Date:** 2026-07-29

## Context

SYSTEM_DESIGN.md §4.2 specifies a price-resolution chain whose final step
derives a price from `avg_cost × default_margin_pct`, and §4.3 specifies
category-level min/max bounds as percentages of **cost**. Both are
cost-derived values.

[ARCHITECTURE.md §6](../ARCHITECTURE.md#6-data--consistency-invariants) invariant 10 is absolute: cost price must never leak to users
without `pricing.view_cost` — not in serializer fields, selector querysets,
UI components, or **error messages**. A price resolved as `avg_cost × margin`
discloses cost to any cashier who triggers it; a "below minimum" error whose
bound is computed from cost discloses cost in the billing error path. Cashiers
resolve prices constantly and do not hold `pricing.view_cost`.

The two requirements are in direct conflict wherever a cost-derived price or
bound would surface to a non-cost user.

## Decision

Invariant 10 wins. In `apps/pricing`:

- **Resolution chain** (first hit wins, prices effective on the business
  date): `item_price` at VARIANT scope → ITEM scope → CATEGORY scope
  (walking up the category tree, nearest ancestor first) → **`variant.mrp`
  fallback**. There is no cost-derived step. If nothing matches and the
  variant has no MRP, resolution fails with `409 PRICE_NOT_SET` — the shop
  must set an explicit price.
- **Category min/max bounds** (`min_price_pct` / `max_price_pct`) are
  percentages of **MRP**, not of cost. Effective bounds resolve variant
  override → item → category, walking up the tree.
- Below-minimum sales require `pricing.override_min` plus a recorded reason;
  above-maximum is always rejected. Error messages name the rule
  ("below minimum selling price") without figures that would disclose cost.

## Consequences

- Shops that want cost-plus pricing must set explicit prices (per variant,
  item, or category) rather than relying on an automatic margin — an
  acceptable trade: automatic margin prices would silently reprice whenever
  average cost moved, which is surprising at the counter.
- A future cost-plus **suggestion** feature (e.g. "propose prices from
  margin") is still possible, but it must run as an explicit, permission-gated
  action that *writes* an `item_price` row — never as an implicit resolution
  step. If that lands, revisit this ADR.
- SYSTEM_DESIGN.md §4.2 step 4 and §4.3 pct-of-cost bounds are superseded by
  this ADR.
