# Rate Rules — the pricing engine

How selling prices are stored, resolved, and guarded. This doc describes the
code as it stands in `backend/apps/pricing/` (`models.py`, `services.py`,
`selectors.py`, `views.py`). The authoritative specification is
`docs/SYSTEM_DESIGN.md` §4, **as amended by
[ADR 0005](DECISIONS/0005-pricing-never-derives-from-cost.md)** — where this
doc and the code disagree, the code is right.

Money-critical module: 100% test coverage is required on `apps/pricing/`
(AGENTS.md, Testing strategy).

---

## 1. Concepts

| Term | What it is | Where |
|---|---|---|
| **Rate type** | A named selling rate (Thok/wholesale, Khudra/retail, Member, …). Exactly one default per tenant. | `rate_type` |
| **Item price** | An effective-dated price for one rate type at exactly one scope (variant, item, or category). | `item_price` |
| **MRP** | The variant's printed maximum retail price; the final resolution fallback. | `catalog.ItemVariant.mrp` |
| **Min/max bounds** | Selling-price guardrails on a variant or item, or as a percentage of MRP on a category. | `min_selling_price` / `max_selling_price`, `min_price_pct` / `max_price_pct` |
| **Price change log** | Append-only record of every price write, old → new. | `price_change_log` |

**Prices never derive from cost** (ADR 0005). There is no
`avg_cost × margin` step anywhere in resolution or bounds, because cashiers
resolve prices constantly and do not hold `pricing.view_cost` — a
cost-derived price or bound would leak cost to them (invariant 10).

---

## 2. Rate types

A `RateType` is a dynamic selling rate: `code` (unique per tenant), `name`,
optional `name_np`, `sort_order`, and an optional `default_margin_pct`
(informational — nothing derives prices from it; see ADR 0005).

Rules enforced in the schema and in `services.py`:

- **Exactly one default per tenant.** A partial unique constraint
  (`rate_type_one_default_per_tenant`) enforces it at the DB level; creating or
  updating a rate type with `is_default=True` unsets the previous default in
  the same transaction (`_unset_default`).
- **Permission gating.** `required_permission` is an optional FK to the
  global permission catalog. NULL means anyone who can bill may use the rate;
  otherwise `resolve_price` refuses with `403 PRICING_RATE_FORBIDDEN` unless
  the user holds that codename (`_assert_rate_allowed`).
- **Soft delete only.** Deactivation sets `is_active = false`; historical
  invoices reference rate types, so rows are never deleted. The **default**
  rate type cannot be deactivated (`RATE_TYPE_IN_USE`).
- **Plan gating.** Creating a rate type requires the `custom_rate_types` plan
  feature and counts against the plan's `max_rate_types` limit
  (`require_plan_feature`, `enforce_creation_limit`) under a tenant-row lock.

---

## 3. Item prices and effective dating

An `ItemPrice` is a price for one rate type at **exactly one scope**:

- `VARIANT` — one `ItemVariant`
- `ITEM` — one `Item` (all its variants)
- `CATEGORY` — one `Category` (matches at resolution while walking up the tree)

A CHECK constraint (`item_price_scope_fk_check`) enforces that exactly the FK
matching `scope` is set and the other two are NULL. The service validates the
same thing before writing (`SCOPE_TARGET_REQUIRED`), so bad rows can never
reach the constraint.

Prices are **effective-dated**: a price is active on date `d` when
`effective_from <= d AND (effective_to IS NULL OR effective_to >= d)`; ties
break by most recent `effective_from`. Writing a price for the same
scope + rate type + `effective_from` **replaces** the existing row rather
than duplicating it.

---

## 4. The resolution chain

`resolve_price(tenant, variant=…, rate_type=…, user=…)` — deterministic,
first hit wins (SYSTEM_DESIGN §4.2 as amended by ADR 0005):

```
1. VARIANT-scope price for this variant          → source "VARIANT"
2. ITEM-scope price for the variant's item       → source "ITEM"
3. CATEGORY-scope price, walking up the category
   tree from the item's category, nearest
   ancestor first                                → source "CATEGORY"
4. variant.mrp, if set                           → source "MRP"
5. otherwise                                     → 409 PRICE_NOT_SET
```

Step 0 is the permission check on the rate type (§2). If the chain exhausts
without a price, the sale cannot proceed: the API returns
`409 PRICE_NOT_SET` and the cashier must set a price first — an explicit
price is required, never a guessed one. The fallback is `variant.mrp`,
**not** a cost-derived price (ADR 0005).

The chain is implemented only in `apps/pricing`. Sales calls it; no other
module reimplements it (see the module map in `docs/ARCHITECTURE.md` §4).

---

## 5. Min/max guardrails

`effective_price_bounds(tenant, variant=…)` resolves the effective
`(min, max)` pair, first source wins, per bound independently:

```
1. variant.min_selling_price / variant.max_selling_price
2. item.min_selling_price / item.max_selling_price
3. walking up the category tree: category.min_price_pct /
   category.max_price_pct applied to variant.mrp
   (requires an MRP; no MRP → no category bound)
```

Category bounds are **percentages of MRP**, not of cost — a cost-derived
bound would leak cost into billing error messages for cashiers (ADR 0005,
invariant 10).

`assert_price_within_bounds(...)` enforces:

| Situation | Result |
|---|---|
| Price above max | **Always rejected** — `PRICE_ABOVE_MAX`. No override exists. |
| Price below min, user holds `pricing.override_min`, reason given | Allowed; the reason is recorded (the invoice-time audit trail lands with the sales app). |
| Price below min, user holds `pricing.override_min`, no reason | `OVERRIDE_REASON_REQUIRED`. |
| Price below min, no permission | `PRICE_BELOW_MIN`. |

Error messages name the rule and the **selling-price** bound
(`"Below the minimum selling price (Rs …)"`) — allowed, because the bound
itself is a selling price. They never contain a cost figure, not even a
derived one ("below cost" would itself be a disclosure).

Bounds themselves are changed via `set_price_bounds`, gated on
`pricing.set_bounds` at the view layer; min > max is rejected
(`PRICE_BOUNDS_INVALID`) and the change is audited (`price.set_bounds`).

---

## 6. PriceChangeLog

Every price write through `set_price` creates a `PriceChangeLog` row **in the
same transaction**: `target_type` (VARIANT/ITEM/CATEGORY), `target_id`,
rate type, `old_price` (the price effective at that scope on
`effective_from`, or NULL), `new_price`, `changed_by`, and `reason`
(required for below-min overrides). The row is written whether the write
created a new `ItemPrice` or replaced an existing one for the same
scope + rate + date, so the log — not the price table — is the full history.

The table is append-only in spirit: no update/delete code path exists, and
the DB-level `REVOKE UPDATE, DELETE` lands with the audit app, the same
treatment `stock_movement` received. Reads require `pricing.view`; the log
contains selling prices only, never cost, regardless of permissions.

---

## 7. Permissions and API surface

| Route permission | Covers |
|---|---|
| `pricing.view` | List rate types, prices, price changes |
| `pricing.edit` | Create/update/deactivate rate types; set prices |
| `pricing.set_bounds` | Change min/max bounds on items and variants |
| `pricing.override_min` | Sell below the minimum (with a recorded reason) |
| `pricing.view_cost` | Unrelated to pricing reads — these tables hold no cost columns at all |

Plan enforcement sits above route permissions: rate-type creation additionally
requires the `custom_rate_types` feature and respects `max_rate_types`.

---

## 8. Cost-visibility rules (why this module looks this way)

Invariant 10 is absolute: cost must never reach a user without
`pricing.view_cost` — not in serializer fields, selector querysets, UI
components, or error messages. Consequences baked into this module:

- Resolution and bounds never touch `avg_cost` (ADR 0005).
- `PriceResolution` carries `price`, `source`, and the `ItemPrice` row — no
  cost field exists to accidentally serialize.
- Selectors take an explicit `user` argument by convention (design §8.1),
  even though these tables have no cost columns to drop.
- A future cost-plus **suggestion** feature is still possible, but only as an
  explicit, permission-gated action that *writes* an `item_price` row — never
  as an implicit resolution step (ADR 0005, consequences).
