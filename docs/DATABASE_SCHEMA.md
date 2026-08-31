# Database Schema

The living data map. Derived from `docs/SYSTEM_DESIGN.md` §3; when the schema
changes, this file changes **in the same PR** (a doc invalidated by a PR and not
updated gets deleted, not fixed later). Conventions and invariants here are
normative; the migrations are the source of truth for exact DDL.

---

## 1. Global conventions

| Convention | Rule |
|---|---|
| Primary keys | `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` on every table (Decision — see below) |
| Tenant column | Every tenant-scoped table: `tenant_id uuid NOT NULL REFERENCES tenant(id)` + RLS policy (see `docs/MULTI_TENANCY.md`) |
| Money | `numeric(14,2)` NPR, never float. Computed in services via `core/money.py` (Decision — precision below) |
| Quantities | `numeric(12,3)` — integer for PCS today, headroom for fractional units (Decision) |
| Percentages | `numeric(5,2)` (0–100) |
| Timestamps | `timestamptz` UTC (`created_at`, `updated_at`, `*_at`). `DEFAULT now()` where sensible |
| Business dates | `business_date_ad date`, `business_date_bs char(10)` (`'2082-04-12'`, zero-padded, lexicographically sortable), `fiscal_year_bs char(7)` (`'2082-83'`, Shrawan 1 → Ashad end). Denormalized **on every transaction table**, computed once in the service layer at write time |
| Enums | `text` + `CHECK (... IN (...))`. No Postgres enum types — they make additive migrations painful (Decision; the design sketches enums but does not mandate a mechanism) |
| Nullable text | `NULL`, never empty-string-as-absent |
| Soft delete | Only where stated (`tenant.deleted_at`, rate types via `is_active`). Master data deactivates (`is_active = false`); transaction rows are never deleted |
| Index rule | **Every composite index on a tenant table leads with `tenant_id`** so RLS predicates are index-covered |
| Naming | Tables snake_case singular (`sales_invoice`, not `sales_invoices`); join/child tables `<parent>_<child>` (`sales_invoice_item`); FK columns `<referenced_table>_id` |

**Decisions recorded here because SYSTEM_DESIGN.md §3 is a sketch without column
types:**

1. **uuid primary keys** — the RLS policy casts `app.tenant_id` to `uuid` and the
   JWT `tenant` claim is a uuid; using uuid everywhere keeps tenants, users, and
   documents uniformly non-sequential (also avoids leaking record counts).
2. **Money precision `numeric(14,2)`** — the design mandates Decimal money in NPR
   but not precision; 14 integer digits covers any realistic figure with room.
3. **Enums as `text` + `CHECK`** — conservative, matches the sketch's bracket
   notation, avoids Postgres enum migration pain.
4. **`tenant_id` on child/line tables** (`sales_invoice_item`, `purchase_invoice_item`,
   `stock_transfer_item`, `stock_count_item`, `party_ledger_entry`, `payment`
   already has it) — §3.2's header states "every table has `tenant_id`, all
   RLS-protected"; the sketches omit it on some children for brevity. RLS must
   protect direct access to child rows, so they carry it.

Every tenant-scoped table below is assumed to have, in addition to its listed
columns, `tenant_id uuid NOT NULL` + `ENABLE/FORCE ROW LEVEL SECURITY` + the
`tenant_isolation` policy from `docs/MULTI_TENANCY.md` §2 — this is not repeated
per table.

---

## 2. Platform scope (no RLS, super-admin service only)

These tables have **no `tenant_id`** and are unreachable from tenant requests.

### 2.1 `plan`

Subscription plan definition.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| code | text | no | UNIQUE, e.g. `basic`, `pro` |
| name | text | no | |
| price_npr | numeric(14,2) | no | |
| billing_cycle | text | no | CHECK IN (`monthly`,`yearly`) |
| limits | jsonb | no | `max_users`, `max_branches`, `max_items`, `max_invoices_per_month`, `storage_mb`, `sms_credits_per_month`, `data_retention_years` |
| features | jsonb | no | `multi_branch`, `custom_rate_types`, `max_rate_types`, `vat_module`, `ird_sync`, `sms`, `loyalty`, `api_access`, `offline_pos`, `barcode_printing`, `profit_reports`, `export_excel` |
| is_active | boolean | no | default true |
| sort_order | integer | no | default 0 |

### 2.2 `tenant`

The shop. Resolved by slug in `TenantMiddleware` before any RLS context exists.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| slug | text | no | UNIQUE; 3–30 chars `[a-z0-9-]`; immutable; reserved-slug blocklist enforced in app |
| name | text | no | |
| name_np | text | yes | Nepali display name |
| legal_name | text | yes | |
| pan_vat_no | text | yes | printed on tax invoices |
| vat_registered | boolean | no | default false |
| plan_id | uuid FK → plan | no | |
| status | text | no | CHECK IN (`TRIAL`,`ACTIVE`,`PAST_DUE`,`SUSPENDED`,`CANCELLED`) |
| trial_ends_at | timestamptz | yes | |
| timezone | text | no | default `'Asia/Kathmandu'` |
| calendar_pref | text | no | CHECK IN (`BS`,`AD`,`BOTH`), default `BS` |
| locale | text | no | CHECK IN (`np`,`en`), default `np` |
| currency | text | no | CHECK IN (`NPR`,`INR`), default `NPR` |
| shopfront_subdomain | text | yes | UNIQUE when set; public online-store host label under the root domain; NULL = no storefront. Must never equal any tenant `slug` (shared wildcard host) — enforced in the service layer |
| shopfront_template | text | no | `aurora`/`bazaar`, default `aurora` — storefront design, SUPER_ADMIN-assigned |
| onboarded_at | timestamptz | yes | |
| created_at | timestamptz | no | default now() |
| deleted_at | timestamptz | yes | soft delete only |

Indexes: UNIQUE `(slug)`; `(status)` for the admin dashboard.

### 2.3 `tenant_subscription`

Billing period per tenant.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| tenant_id | uuid FK → tenant | no | |
| plan_id | uuid FK → plan | no | |
| period_start | date | no | |
| period_end | date | no | |
| amount_npr | numeric(14,2) | no | |
| status | text | no | e.g. `PENDING`,`PAID`,`FAILED` (CHECK) |
| payment_ref | text | yes | |
| invoice_url | text | yes | |

Index: `(tenant_id, period_start DESC)`.

### 2.4 `tenant_feature_override`

Per-tenant override of plan limits/features (e.g. a grandfathered limit).

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| tenant_id | uuid FK → tenant | no | |
| key | text | no | dotted key into plan limits/features, e.g. `limits.max_users` |
| value | jsonb | no | |
| expires_at | timestamptz | yes | NULL = permanent |
| note | text | yes | why this override exists |

Index: UNIQUE `(tenant_id, key)`.

### 2.5 `tenant_usage_snapshot`

Written nightly by a Celery job; feeds the super-admin dashboard and billing.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| tenant_id | uuid FK → tenant | no | |
| date | date | no | |
| users | integer | no | |
| items | integer | no | |
| invoices_mtd | integer | no | invoices month-to-date |
| storage_mb | integer | no | |
| sms_used | integer | no | |

Index: UNIQUE `(tenant_id, date)`.

### 2.6 `platform_user`

Super admin / support / billing staff. **Separate table and token audience from
tenant `user` — never a row in both.**

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| email | text | no | UNIQUE |
| password_hash | text | no | |
| full_name | text | no | |
| role | text | no | CHECK IN (`SUPER_ADMIN`,`SUPPORT`,`BILLING`) |
| totp_secret | text | yes | mandatory 2FA for admin portal access |
| is_active | boolean | no | default true |
| last_login_at | timestamptz | yes | |

### 2.7 `impersonation_session`

Support access record (SYSTEM_DESIGN §2.6). Security-critical.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| platform_user_id | uuid FK → platform_user | no | who is impersonating |
| tenant_id | uuid FK → tenant | no | |
| target_user_id | uuid | no | the tenant `user` being impersonated |
| reason | text | no | min 20 chars, enforced in service |
| scope | text | no | CHECK IN (`READ_ONLY`,`READ_WRITE`), default `READ_ONLY` |
| ip | inet | yes | |
| user_agent | text | yes | |
| started_at | timestamptz | no | default now() |
| expires_at | timestamptz | no | ≤ 60 min after start |
| ended_at | timestamptz | yes | |
| ended_by | uuid | yes | platform_user or tenant owner who ended it |

Index: `(tenant_id, started_at DESC)`.

### 2.8 `platform_audit_log`

Audit of super-admin actions (impersonation start/end, plan changes, suspension).

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| platform_user_id | uuid FK → platform_user | no | |
| action | text | no | |
| tenant_id | uuid FK → tenant | yes | affected tenant, if any |
| payload | jsonb | yes | |
| ip | inet | yes | |
| created_at | timestamptz | no | default now() |

Append-only: `REVOKE UPDATE, DELETE` from the app role. Index: `(tenant_id, created_at DESC)`.

---

## 3. Tenant scope — identity & structure

### 3.1 `branch`

Physical outlet. Stock, invoice series, and staff are branch-scoped.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| code | text | no | UNIQUE `(tenant_id, code)` |
| name | text | no | |
| name_np | text | yes | |
| address | text | yes | |
| phone | text | yes | |
| invoice_prefix | text | no | e.g. `INV`; used in gapless numbering |
| is_default | boolean | no | exactly one default per tenant (partial unique index `WHERE is_default`) |
| is_active | boolean | no | default true |

### 3.2 `user`

Tenant staff. Phone-based login.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| phone | text | no | UNIQUE `(tenant_id, phone)` |
| email | text | yes | |
| password_hash | text | no | |
| full_name | text | no | |
| is_active | boolean | no | default true |
| must_change_password | boolean | no | default false |
| login_otp_required | boolean | no | default false; optional SMS code after password |
| last_login_at | timestamptz | yes | |
| failed_login_count | integer | no | default 0 |
| locked_until | timestamptz | yes | |

### 3.2.1 `auth_session`

Registered tenant-user devices. Access and refresh JWTs carry this row's id as
`sid`; revocation is checked on every authenticated request.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | JWT `sid` |
| tenant_id | uuid FK → tenant | no | RLS; every index leads with tenant |
| user_id | uuid FK → user | no | |
| device_id | uuid | no | stable non-secret browser/device identifier |
| device_name | varchar(100) | no | user-visible label |
| user_agent | text | no | default empty |
| ip | inet | yes | request source at login |
| last_seen_at | timestamptz | no | touch writes bounded to five minutes |
| expires_at | timestamptz | no | matches refresh lifetime |
| revoked_at | timestamptz | yes | non-NULL rejects access and refresh immediately |

Indexes: `(tenant_id, user_id, created_at DESC)`,
`(tenant_id, expires_at)`; partial UNIQUE
`(tenant_id, user_id, device_id) WHERE revoked_at IS NULL`.

### 3.2.2 `account_otp`

Short-lived tenant-user security challenges. Raw codes are sent through the
notification provider and never stored in this table.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | challenge id; included in the HMAC input |
| tenant_id | uuid FK → tenant | no | RLS |
| user_id | uuid FK → user | no | |
| purpose | varchar(20) | no | `PASSWORD_RESET`, `LOGIN`, `LOGIN_ENABLE` |
| code_hash | char(64) | no | HMAC-SHA256; never the raw six-digit code |
| expires_at | timestamptz | no | ten-minute TTL |
| attempts | smallint | no | locks at five failures |
| consumed_at | timestamptz | yes | single-use marker |

Indexes: `(tenant_id, user_id, purpose, created_at DESC)`,
`(tenant_id, expires_at)`.

### 3.3 `role`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| code | text | no | UNIQUE `(tenant_id, code)`; e.g. `OWNER`,`MANAGER`,`CASHIER`,`STOCK_KEEPER`,`ACCOUNTANT` |
| name | text | no | |
| name_np | text | yes | |
| is_system | boolean | no | system roles seeded per tenant; cannot be deleted |
| description | text | yes | |

### 3.4 `permission` — global catalog (no `tenant_id`, no RLS)

The single source of truth is `core/permissions/catalog.py`; this table is its
DB mirror.

| Column | Type | Null | Notes |
|---|---|---|---|
| code | text PK | no | e.g. `sale.create`, `pricing.view_cost` |
| module | text | no | |
| name | text | no | |
| description | text | yes | |
| is_sensitive | boolean | no | sensitive perms get extra audit |

### 3.5 `role_permission`

| Column | Type | Null | Notes |
|---|---|---|---|
| role_id | uuid FK → role | no | PK is composite |
| permission_code | text FK → permission | no | |

PK `(role_id, permission_code)`. `role` is tenant-scoped, so this join is
protected transitively — writes still go through tenant-scoped services.
*(Decision: the sketch shows no `tenant_id` here; it is added in implementation
if direct RLS protection of this table is preferred — the isolation suite
decides.)*

### 3.6 `user_role`

Role assignment, optionally branch-scoped.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| user_id | uuid FK → user | no | |
| role_id | uuid FK → role | no | |
| branch_id | uuid FK → branch | yes | **NULL = all branches** |

Index: UNIQUE `(tenant_id, user_id, role_id, branch_id)` (NULLs handled via
`NULLS NOT DISTINCT` or a coalesced expression — implementation detail);
`(tenant_id, user_id)` for permission resolution.

---

## 4. Tenant scope — catalog

### 4.1 `category`

Self-referencing tree.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| parent_id | uuid FK → category | yes | NULL = root |
| name | text | no | |
| name_np | text | yes | |
| size_chart_id | uuid FK → size_chart | yes | inherited by items unless overridden |
| default_margin_pct | numeric(5,2) | yes | used by derived price resolution (step 4) |
| min_price_pct | numeric(5,2) | yes | category-level floor as % of cost |
| max_price_pct | numeric(5,2) | yes | category-level ceiling as % of cost |
| sort_order | integer | no | default 0 |
| is_active | boolean | no | default true |

Index: `(tenant_id, parent_id)`.

### 4.2 `brand`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| name | text | no | UNIQUE `(tenant_id, name)` |
| is_active | boolean | no | default true |

### 4.3 `size_chart`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| name | text | no | e.g. `Shirt Sizes`, `Jeans Waist` |
| values | text[] | no | ORDERED — `['S','M','L','XL']` or `['28','30','32']`; array order is display order |

### 4.4 `item`

The style. Never stocked or sold directly — variants are.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| code | text | no | UNIQUE `(tenant_id, code)` |
| name | text | no | |
| name_np | text | yes | |
| category_id | uuid FK → category | yes | |
| brand_id | uuid FK → brand | yes | |
| size_chart_id | uuid FK → size_chart | yes | |
| gender | text | yes | CHECK IN (`M`,`F`,`U`,`KIDS`) |
| season | text | yes | e.g. `winter`, `summer` |
| collection_tag | text | yes | e.g. `dashain-2082` — campaign slicing |
| hsn_code | text | yes | |
| unit | text | no | default `'PCS'` |
| is_vat_applicable | boolean | no | default false |
| image | varchar(100) | yes | one photo per item; storage key under `tenants/<tenant_id>/items/` on the media volume; served at `/media/...`; written only by `catalog.services.set_item_image` (2 MB cap, jpeg/png/webp sniffed with Pillow) |
| images | jsonb | yes | list of storage keys/URLs |
| attributes | jsonb | yes | **deliberate escape hatch instead of EAV**: fabric, fit, care, … Display only |
| min_selling_price | numeric(14,2) | yes | NULL = inherit from category |
| max_selling_price | numeric(14,2) | yes | NULL = inherit from category |
| website_price | numeric(14,2) | yes | single price shown on the online store (in the `store_settings.currency` website currency) instead of the selling-price range; NULL = grid falls back to the range |
| reorder_level | numeric(12,3) | yes | |
| is_active | boolean | no | default true |
| created_by | uuid FK → user | yes | |
| created_at | timestamptz | no | default now() |

Indexes: UNIQUE `(tenant_id, code)`; `(tenant_id, category_id)`;
GIN `to_tsvector('simple', name || ' ' || code)` for search (+ `pg_trgm` for
typo tolerance per §7.5).

### 4.5 `item_variant`

The sellable, stockable unit (SKU = size × colour).

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| item_id | uuid FK → item | no | |
| size | text | no | |
| color | text | no | |
| color_hex | text | yes | e.g. `#1e40af`, for chips in the UI |
| sku | text | no | UNIQUE `(tenant_id, sku)` |
| barcode | text | yes | UNIQUE `(tenant_id, barcode) WHERE barcode IS NOT NULL` — the POS hot path; Code 128 generated in-house, EAN-13 accepted from suppliers (ADR 0003) |
| mrp | numeric(14,2) | yes | printed on the tag; visible to everyone |
| min_selling_price | numeric(14,2) | yes | NULL → inherit item → category |
| max_selling_price | numeric(14,2) | yes | NULL → inherit item → category |
| avg_cost | numeric(14,2) | no | default 0; moving weighted average; **`pricing.view_cost` only** |
| is_active | boolean | no | default true |

Constraints: UNIQUE `(item_id, size, color)`.
Indexes: partial UNIQUE `(tenant_id, barcode) WHERE barcode IS NOT NULL`;
`(tenant_id, sku)`; `(tenant_id, item_id)`.

---

## 5. Tenant scope — pricing

### 5.1 `rate_type`

Dynamic selling rates (`Thok`, `Khudra`, `Member`, `VIP`, …).

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| code | text | no | UNIQUE `(tenant_id, code)` |
| name | text | no | |
| name_np | text | yes | |
| is_default | boolean | no | exactly one default per tenant (partial UNIQUE `(tenant_id) WHERE is_default`) |
| sort_order | integer | no | default 0 |
| default_margin_pct | numeric(5,2) | yes | for derived pricing over `avg_cost` |
| required_permission | text FK → permission.code | yes | NULL = anyone who can bill; e.g. only Manager+ bills at `Thok` |
| is_active | boolean | no | **soft-delete only** — historical invoices reference rate types |

Count per tenant capped by `plan.features.max_rate_types`.

### 5.2 `item_price`

Price per rate type at one of three scopes; resolution is first-hit-wins
VARIANT → ITEM → CATEGORY → derived → `409 PRICE_NOT_SET`.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| rate_type_id | uuid FK → rate_type | no | |
| scope | text | no | CHECK IN (`VARIANT`,`ITEM`,`CATEGORY`) |
| variant_id | uuid FK → item_variant | yes | exactly the FK matching `scope` is set |
| item_id | uuid FK → item | yes | |
| category_id | uuid FK → category | yes | |
| price | numeric(14,2) | no | |
| effective_from | date | no | |
| effective_to | date | yes | NULL = open-ended |
| created_by | uuid FK → user | yes | |
| created_at | timestamptz | no | default now() |

CHECK: exactly one of `variant_id`/`item_id`/`category_id` is NOT NULL, matching
`scope`. Index: `(tenant_id, rate_type_id, scope, variant_id, item_id,
category_id, effective_from)` (per §3.4 sketch).

### 5.3 `price_change_log`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| target_type | text | no | what changed: `VARIANT`,`ITEM`,`CATEGORY` |
| target_id | uuid | no | |
| rate_type_id | uuid FK → rate_type | yes | |
| old_price | numeric(14,2) | yes | |
| new_price | numeric(14,2) | no | |
| changed_by | uuid FK → user | no | |
| reason | text | yes | required for min-price overrides |
| created_at | timestamptz | no | default now() |

Append-only. Index: `(tenant_id, target_type, target_id, created_at DESC)`.

---

## 6. Tenant scope — inventory

### 6.1 `stock_level` — projection

Fast read model. Written only in the same transaction as its `stock_movement`
rows; re-derived monthly from the ledger with drift alerts.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | no | |
| variant_id | uuid FK → item_variant | no | |
| qty_on_hand | numeric(12,3) | no | default 0 |
| qty_reserved | numeric(12,3) | no | default 0 (held bills) |
| avg_cost | numeric(14,2) | no | default 0; moving weighted average per branch |
| updated_at | timestamptz | no | |

Constraints: UNIQUE `(branch_id, variant_id)`.
Index: `(tenant_id, branch_id) WHERE qty_on_hand <= 0` (low/out-of-stock scans).

### 6.2 `stock_movement` — IMMUTABLE LEDGER

**The only way stock changes.** Append-only: `REVOKE UPDATE, DELETE` from the
app role. Never updated, never deleted.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | no | |
| variant_id | uuid FK → item_variant | no | |
| type | text | no | CHECK IN (`OPENING`,`PURCHASE`,`SALE`,`SALE_RETURN`,`PURCHASE_RETURN`,`TRANSFER_IN`,`TRANSFER_OUT`,`ADJUSTMENT`,`DAMAGE`,`COUNT`) |
| qty_delta | numeric(12,3) | no | signed |
| unit_cost | numeric(14,2) | yes | cost at movement time, `pricing.view_cost` only |
| balance_after | numeric(12,3) | no | running balance for the ledger view |
| ref_type | text | yes | e.g. `sales_invoice`, `purchase_invoice`, `stock_transfer` |
| ref_id | uuid | yes | |
| note | text | yes | |
| business_date_ad | date | no | |
| business_date_bs | char(10) | no | |
| fiscal_year_bs | char(7) | no | |
| created_by | uuid FK → user | yes | |
| created_at | timestamptz | no | default now() |

Indexes: `(tenant_id, variant_id, created_at DESC)`;
`(tenant_id, branch_id, business_date_bs)`; `(tenant_id, ref_type, ref_id)`.

### 6.3 `stock_batch`

Receipt batches; exists so FIFO could be revived later (costing today is moving
weighted average).

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | no | |
| variant_id | uuid FK → item_variant | no | |
| purchase_item_id | uuid FK → purchase_invoice_item | yes | |
| qty_in | numeric(12,3) | no | |
| qty_remaining | numeric(12,3) | no | |
| unit_cost | numeric(14,2) | no | |
| landed_cost | numeric(14,2) | yes | unit cost + allocated charges |
| received_at | timestamptz | no | |

Index: `(tenant_id, variant_id, received_at)`.

### 6.4 `stock_transfer` / 6.5 `stock_transfer_item`

Inter-branch movement with in-transit state (Phase 2).

`stock_transfer`:

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| from_branch_id | uuid FK → branch | no | |
| to_branch_id | uuid FK → branch | no | CHECK `from <> to` |
| status | text | no | CHECK IN (`DRAFT`,`SENT`,`RECEIVED`,`CANCELLED`) |
| sent_at | timestamptz | yes | |
| received_at | timestamptz | yes | |
| created_by | uuid FK → user | yes | |
| note | text | yes | |

`stock_transfer_item` (carries `tenant_id` per global rule):

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| transfer_id | uuid FK → stock_transfer | no | |
| variant_id | uuid FK → item_variant | no | |
| qty_sent | numeric(12,3) | no | |
| qty_received | numeric(12,3) | yes | NULL until received; variance = shortage |

Movements: `TRANSFER_OUT` on send, `TRANSFER_IN` on receive, written by the
inventory service in each transition's transaction.

### 6.6 `stock_count` / 6.7 `stock_count_item`

Physical count (Phase 2).

`stock_count`:

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | no | |
| status | text | no | CHECK IN (`OPEN`,`FINALIZED`,`CANCELLED`) |
| started_at | timestamptz | no | |
| finalized_at | timestamptz | yes | |
| created_by | uuid FK → user | yes | |

`stock_count_item` (carries `tenant_id`):

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| count_id | uuid FK → stock_count | no | |
| variant_id | uuid FK → item_variant | no | |
| system_qty | numeric(12,3) | no | snapshot at count start |
| counted_qty | numeric(12,3) | yes | |
| variance | numeric(12,3) | yes | counted − system |
| note | text | yes | |

Finalization writes `COUNT` movements for variances.

---

## 7. Tenant scope — purchasing

### 7.1 `supplier`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| name | text | no | |
| phone | text | yes | |
| pan_no | text | yes | needed on VAT purchase register |
| address | text | yes | |
| opening_balance | numeric(14,2) | no | default 0; + = we owe them |
| credit_days | integer | yes | for payable due dates |
| is_active | boolean | no | default true |

### 7.2 `purchase_invoice`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | no | |
| supplier_id | uuid FK → supplier | no | |
| invoice_no | text | no | internal number from `number_sequence` |
| supplier_bill_no | text | yes | the supplier's own bill number |
| bill_date_ad | date | no | |
| bill_date_bs | char(10) | no | denormalized |
| fiscal_year_bs | char(7) | no | denormalized |
| subtotal | numeric(14,2) | no | |
| discount | numeric(14,2) | no | default 0 |
| taxable_amount | numeric(14,2) | no | |
| vat_amount | numeric(14,2) | no | default 0 |
| other_charges | numeric(14,2) | no | default 0; transport etc., allocated to landed cost |
| total | numeric(14,2) | no | |
| paid_amount | numeric(14,2) | no | default 0 |
| due_amount | numeric(14,2) | no | |
| status | text | no | CHECK IN (`DRAFT`,`CONFIRMED`,`CANCELLED`) |
| note | text | yes | |
| created_by | uuid FK → user | yes | |
| created_at | timestamptz | no | default now() |

`CONFIRMED` writes `PURCHASE` movements + payables ledger entries, in one
transaction. DRAFT rows may be edited; CONFIRMED rows are corrected via
`PURCHASE_RETURN`, not edits. Index: `(tenant_id, supplier_id, bill_date_bs)`,
`(tenant_id, status)`.

### 7.3 `purchase_invoice_item`

Carries `tenant_id` (global rule).

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| purchase_invoice_id | uuid FK → purchase_invoice | no | |
| variant_id | uuid FK → item_variant | no | |
| qty | numeric(12,3) | no | |
| unit_cost | numeric(14,2) | no | |
| discount | numeric(14,2) | no | default 0 |
| line_total | numeric(14,2) | no | |

Index: `(purchase_invoice_id)`; `(tenant_id, variant_id)`.

---

## 8. Tenant scope — sales

### 8.1 `customer`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| name | text | no | |
| phone | text | yes | UNIQUE `(tenant_id, phone) WHERE phone IS NOT NULL` |
| address | text | yes | |
| default_rate_type_id | uuid FK → rate_type | yes | auto-selects rate at billing |
| credit_limit | numeric(14,2) | no | default 0; udharo ceiling |
| opening_balance | numeric(14,2) | no | default 0 |
| loyalty_points | numeric(12,2) | no | default 0 (Phase 2) |
| birthday_bs | char(10) | yes | for festival/birthday SMS |
| gender | text | yes | |
| note | text | yes | |
| is_active | boolean | no | default true |
| created_at | timestamptz | no | default now() |

### 8.2 `sales_invoice`

**Completed invoices are never updated or deleted.** Corrections are `RETURN`
documents referencing the original.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | no | |
| invoice_no | text | no | gapless; UNIQUE `(tenant_id, branch_id, fiscal_year_bs, invoice_no)` |
| doc_type | text | no | CHECK IN (`SALE`,`RETURN`,`EXCHANGE_OUT`) |
| original_invoice_id | uuid FK → sales_invoice | yes | set on RETURN/EXCHANGE_OUT |
| exchange_group_id | uuid | yes | links the return + sale pair of an exchange |
| customer_id | uuid FK → customer | yes | required when any payment is `CREDIT` |
| rate_type_id | uuid FK → rate_type | no | the rate used for this bill |
| salesperson_id | uuid FK → user | yes | commission attribution (Phase 2) |
| subtotal | numeric(14,2) | no | |
| discount_amount | numeric(14,2) | no | default 0 |
| discount_reason | text | yes | required above role discount limit |
| discount_approved_by | uuid FK → user | yes | |
| taxable_amount | numeric(14,2) | no | |
| vat_amount | numeric(14,2) | no | default 0 |
| round_off | numeric(14,2) | no | default 0 |
| total | numeric(14,2) | no | |
| paid_amount | numeric(14,2) | no | |
| due_amount | numeric(14,2) | no | |
| status | text | no | CHECK IN (`HELD`,`COMPLETED`,`CANCELLED`) |
| is_vat_bill | boolean | no | default false |
| print_count | integer | no | legacy column, default 0; API derives the count from immutable `sale.receipt.print` audit events so completed invoices remain untouched |
| ird_synced_at | timestamptz | yes | CBMS sync status (Phase 2) |
| ird_sync_error | text | yes | last sync failure, visible per bill |
| datetime_ad | timestamptz | no | moment of sale (UTC) |
| business_date_ad | date | no | from `datetime_ad` + `day_start_time` |
| business_date_bs | char(10) | no | denormalized |
| fiscal_year_bs | char(7) | no | denormalized; drives numbering + VAT periods |
| device_id | text | yes | POS device, for offline reconciliation |
| idempotency_key | text | no | UNIQUE `(tenant_id, idempotency_key)`; mandatory on `POST /sales` |
| tenders | jsonb | no | Actual tender split (`[{method, amount}]`); only `CASH` affects drawer reconciliation |
| share_token | uuid | yes | globally UNIQUE; write-once public-bill token for `GET /sales/shared/<token>` |
| created_by | uuid FK → user | yes | |
| created_at | timestamptz | no | default now() |

Indexes (§3.4): `(tenant_id, branch_id, business_date_bs)`;
`(tenant_id, fiscal_year_bs, doc_type)`;
`(tenant_id, customer_id, created_at DESC)`;
partial `(tenant_id, due_amount) WHERE due_amount > 0`.

`HELD` bills are working state and may change; the `COMPLETED` transition is
the point of no return. `CANCELLED` is a terminal correction state for
same-day mistakes before day close — it is a status, never a DELETE.

### 8.3 `sales_invoice_item`

Carries `tenant_id` (global rule).

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| sales_invoice_id | uuid FK → sales_invoice | no | |
| variant_id | uuid FK → item_variant | no | |
| qty | numeric(12,3) | no | |
| rate_type_id | uuid FK → rate_type | no | rate actually applied to the line |
| unit_price | numeric(14,2) | no | after line discount allocation |
| discount | numeric(14,2) | no | default 0 |
| line_total | numeric(14,2) | no | |
| cost_at_sale | numeric(14,2) | no | **SNAPSHOT of avg_cost at sale time. Never recomputed, never updated.** |
| returned_qty | numeric(12,3) | no | default 0; incremented by RETURN docs |

Indexes: `(sales_invoice_id)`; `(variant_id, sales_invoice_id)` (per §3.4).

### 8.4 `payment`

All money in/out. `POST /payments` requires `Idempotency-Key`.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| reversal_of | uuid FK → payment | yes | NULL for an original payment; a reversal is one linked negative counter-entry |
| branch_id | uuid FK → branch | no | |
| direction | text | no | CHECK IN (`IN`,`OUT`) |
| party_type | text | no | CHECK IN (`CUSTOMER`,`SUPPLIER`,`NONE`) |
| party_id | uuid | yes | NULL when `party_type = NONE` |
| method | text | no | CHECK IN (`CASH`,`ESEWA`,`KHALTI`,`FONEPAY`,`QR`,`CARD`,`BANK`,`CREDIT`,`POINTS`) |
| amount | numeric(14,2) | no | positive for originals, negative when `reversal_of` is set |
| ref_no | text | yes | gateway/QR reference |
| sales_invoice_id | uuid FK → sales_invoice | yes | |
| purchase_invoice_id | uuid FK → purchase_invoice | yes | |
| idempotency_key | text | no | UNIQUE `(tenant_id, idempotency_key)` (Decision: same replay contract as sales) |
| business_date_ad | date | no | |
| business_date_bs | char(10) | no | |
| fiscal_year_bs | char(7) | no | |
| created_by | uuid FK → user | yes | |
| created_at | timestamptz | no | default now() |

Append-only (a wrong payment is reversed by one linked counter-entry, not edited).
`payment.reverse` is required; the reversal reason is stored in `note`, and the
same `Idempotency-Key` replays the original reversal with `200`.
Index: `(tenant_id, party_type, party_id, business_date_bs)`;
`(tenant_id, sales_invoice_id)`.

### 8.5 `party_ledger_entry`

The udharo/khata running balance for customers and suppliers. Append-only;
`balance_after` gives the running balance without a sum over history.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| party_type | text | no | CHECK IN (`CUSTOMER`,`SUPPLIER`) |
| party_id | uuid | no | |
| ref_type | text | yes | `sales_invoice`, `payment`, `purchase_invoice`, `opening` |
| ref_id | uuid | yes | |
| debit | numeric(14,2) | no | default 0 |
| credit | numeric(14,2) | no | default 0 |
| balance_after | numeric(14,2) | no | running balance |
| narration | text | yes | |
| business_date_bs | char(10) | no | |
| created_at | timestamptz | no | default now() |

Index: `(tenant_id, party_type, party_id, created_at)`.

### 8.6 `held_bill`

Parked carts. Working state — may be updated and deleted.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | no | |
| label | text | yes | e.g. "dai ko bill" |
| cart | jsonb | no | line items as entered |
| created_by | uuid FK → user | yes | |
| created_at | timestamptz | no | default now() |

---

## 9. Tenant scope — operations

### 9.1 `cash_session`

Drawer open/close with variance. POS sale completion requires an open session for the
branch; holding a bill does not.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | no | |
| opened_by | uuid FK → user | no | |
| opened_at | timestamptz | no | |
| opening_float | numeric(14,2) | no | |
| closed_by | uuid FK → user | yes | |
| closed_at | timestamptz | yes | |
| counted_cash | numeric(14,2) | yes | |
| expected_cash | numeric(14,2) | yes | float + CASH sale/receipt tenders − CASH supplier payments/refunds |
| variance | numeric(14,2) | yes | counted − expected |
| note | text | yes | |

Index: `(tenant_id, branch_id, opened_at DESC)`; one OPEN session per branch
(partial UNIQUE `(branch_id) WHERE closed_at IS NULL`).

### 9.2 `expense`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | yes | NULL = tenant-wide expense |
| category_id | uuid | yes | expense category (a small tenant-scoped lookup; owned by the expenses app) |
| amount | numeric(14,2) | no | |
| method | text | yes | payment method used |
| note | text | yes | |
| business_date_bs | char(10) | no | |
| created_by | uuid FK → user | yes | |
| created_at | timestamptz | no | default now() |
| attachment_url | text | yes | receipt photo |

Index: `(tenant_id, business_date_bs)`.

### 9.3 `number_sequence`

Gapless numbering. The service does
`SELECT ... FOR UPDATE` on the row, increments `next_number`, and uses the value —
all inside the invoice transaction, so a rollback never burns a number.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| branch_id | uuid FK → branch | no | |
| doc_type | text | no | e.g. `SALE`,`RETURN`,`PURCHASE` |
| fiscal_year_bs | char(7) | no | |
| prefix | text | no | e.g. `INV` |
| next_number | integer | no | next value to issue |

Constraint: UNIQUE `(tenant_id, branch_id, doc_type, fiscal_year_bs)`.

### 9.4 `tenant_setting`

Per-tenant configuration (`day_start_time`, `allow_negative_stock`,
`manager_can_view_cost`, `require_manager_approval`, print format, tax config, …).

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| key | text | no | UNIQUE `(tenant_id, key)` |
| value | jsonb | no | |

### 9.5 `audit_log` — append-only

`REVOKE UPDATE, DELETE` from the app role. Written only by explicit `audit(...)`
calls in services, never by signals.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| user_id | uuid | yes | NULL for system actions |
| impersonated_by | uuid | yes | platform_user id when written during support access |
| action | text | no | e.g. `sale.create`, `pricing.override_min` |
| entity | text | no | e.g. `sales_invoice` |
| entity_id | uuid | yes | |
| before | jsonb | yes | |
| after | jsonb | yes | |
| ip | inet | yes | |
| user_agent | text | yes | |
| created_at | timestamptz | no | default now() |

Index: `(tenant_id, entity, entity_id, created_at DESC)`;
`(tenant_id, created_at DESC)`. Retention per plan, minimum 7 years for
financial rows.

### 9.6 `sms_log`

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| tenant_id | uuid FK → tenant | no | RLS isolation key |
| to_phone | text | no | |
| template | text | no | e.g. `receipt`, `otp`, `due_reminder` |
| body | text | no | |
| provider | text | yes | resolved provider name (ADR 0004) |
| provider_message_id | text | yes | provider receipt ID for delivery polling |
| status | text | no | `QUEUED`,`SENT`,`DELIVERED`,`FAILED` |
| cost | numeric(8,4) | yes | per-message cost for plan accounting |
| created_at | timestamptz | no | default now() |
| updated_at | timestamptz | no | last status transition |

Indexes: `(tenant_id, created_at DESC)`, `(tenant_id, status)`.

### 9.7 `store_settings`

One row per tenant (`UNIQUE (tenant_id)`) — the tenant admin's online-store
control panel. The address (`tenant.shopfront_subdomain`) and design
(`tenant.shopfront_template`) stay platform-admin decisions; everything here
is editable by the shop and read anonymously by the public storefront.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | bigint PK | no | |
| tenant_id | uuid FK → tenant | no | RLS isolation key; UNIQUE |
| hero_title | text | no | `''` = fall back to the shop name |
| hero_subtitle | text | no | `''` = template default copy |
| announcement | text | no | `''` = hidden (top strip / marquee) |
| offer_text | text | no | e.g. `Dashain Sale` |
| offer_discount_pct | numeric(5,2) | yes | 0 < pct ≤ 90 (service-enforced); applies to `item.website_price` only, never counter prices |
| currency | text | no | `NPR`/`INR`, default `NPR` — website price entry + display currency; when ≠ tenant currency the public range converts at the 1.6 peg for display |
| created_at | timestamptz | no | default now() |
| updated_at | timestamptz | no | |

### 9.8 `store_customer`

An online shopper, identified by email per tenant. No password — login is a
6-digit email OTP; the row is auto-created on first OTP login or first order.
Distinct from `user` (shop staff) and `customer` (the udharo khata).

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| tenant_id | uuid FK → tenant | no | RLS isolation key; UNIQUE `(tenant_id, email)` |
| email | text | no | login + order contact |
| full_name | text | no | refreshed from the latest order |
| phone | text | no | |
| default_address | jsonb | yes | last delivery address — pre-fills the next checkout |

### 9.9 `store_otp`

One-time login codes: stored hashed (salted SHA-256), 10-minute TTL,
single-use, 5-attempt cap, 60-second resend cooldown.

| Column | Type | Null | Notes |
|---|---|---|---|
| id | uuid PK | no | |
| tenant_id | uuid FK → tenant | no | RLS isolation key |
| email | text | no | |
| code_hash | char(64) | no | |
| expires_at | timestamptz | no | |
| attempts | integer | no | default 0 |
| consumed_at | timestamptz | yes | NULL = still usable |

Index: `(tenant_id, email, created_at)`.

### 9.10 `store_order` / 9.11 `store_order_item`

An online order. Placement validates stock but never decrements it — the
shop confirms in the POS, which posts the SALE through the existing
pipeline (invariant 1). Numbering is the gapless per-branch series
(`doc_type = STORE_ORDER`, prefix `ORD`). Customer-facing payload fields are
snapshotted at placement (address, prices, item names) so later catalog or
profile edits never rewrite order history.

`store_order` columns beyond the conventions: `branch_id` (fulfilling
branch), `customer_id` FK → store_customer, `order_number` + `number_text`
(UNIQUE `(tenant_id, branch_id, fiscal_year_bs, order_number)`), `status`
(`PLACED,CONFIRMED,PACKED,SHIPPED,DELIVERED,CANCELLED`), `fulfillment`
(`DELIVERY,PICKUP`), `payment_method` (`COD,ONLINE`), `payment_status`
(`PENDING,PAID,REFUNDED`), `address` jsonb (delivery snapshot incl. lat/lng,
NULL for pickup), `currency`, `subtotal`/`total`, `offer_text` (snapshot),
`tracking_token` uuid UNIQUE (public tracking link), `idempotency_key`
(UNIQUE when set — mandatory at checkout), plus the standard BS
denormalization (`business_date_ad`, `business_date_bs`, `fiscal_year_bs`).

`store_order_item`: `order_id` FK CASCADE, `variant_id` FK PROTECT,
`name`/`size`/`color` snapshots, `unit_price` (discounted website price or
peg-converted min selling price), `compare_at` (pre-offer price, display
only), `qty`, `line_total`.

---

## 10. Reporting rollups (Phase 2 — created when a tenant crosses ~100k invoice lines)

### 10.1 `daily_sales_summary`

| Column | Type | Notes |
|---|---|---|
| tenant_id, branch_id, business_date_bs | uuid, uuid, char(10) | **PRIMARY KEY (tenant_id, branch_id, business_date_bs)** |
| fiscal_year_bs | char(7) | |
| bill_count, return_count | integer | |
| gross, discount, vat, net, cogs, gross_profit, return_value, cash, digital, credit | numeric(14,2) | |

### 10.2 `daily_item_summary`

| Column | Type | Notes |
|---|---|---|
| tenant_id, branch_id, business_date_bs, variant_id | | composite PRIMARY KEY |
| qty_sold | numeric(12,3) | |
| revenue, cogs | numeric(14,2) | |

Both rebuilt by a Celery job at the tenant's `day_start_time + 1h`, plus an
idempotent `rebuild_summary(tenant, date_range)` command. Reports read summaries
for closed days and live tables for today, then union.

---

## 11. Index plan (hot paths, from §3.4)

```sql
CREATE UNIQUE INDEX ON item_variant (tenant_id, barcode) WHERE barcode IS NOT NULL; -- POS hot path
CREATE INDEX ON item_variant (tenant_id, sku);
CREATE INDEX ON sales_invoice (tenant_id, branch_id, business_date_bs);
CREATE INDEX ON sales_invoice (tenant_id, fiscal_year_bs, doc_type);
CREATE INDEX ON sales_invoice (tenant_id, customer_id, created_at DESC);
CREATE INDEX ON sales_invoice (tenant_id, due_amount) WHERE due_amount > 0;         -- partial: dues
CREATE INDEX ON sales_invoice_item (sales_invoice_id);
CREATE INDEX ON sales_invoice_item (variant_id, sales_invoice_id);
CREATE INDEX ON stock_movement (tenant_id, variant_id, created_at DESC);
CREATE INDEX ON stock_movement (tenant_id, branch_id, business_date_bs);
CREATE INDEX ON stock_level (tenant_id, branch_id) WHERE qty_on_hand <= 0;
CREATE INDEX ON party_ledger_entry (tenant_id, party_type, party_id, created_at);
CREATE INDEX ON item USING gin (to_tsvector('simple', name || ' ' || code));        -- search
```

Plus `pg_trgm` GIN on `item.name`/`item.name_np` for typo-tolerant search (§7.5).
Every composite index on a tenant table leads with `tenant_id`. Indexes on large
tables are created with `CONCURRENTLY` (`AddIndexConcurrently`, `atomic = False`).

---

## 12. Immutability and retention rules

| Rule | Mechanism |
|---|---|
| **Stock changes only via `stock_movement`** (append-only ledger) | `REVOKE UPDATE, DELETE` from app role; `stock_level` projection written in the same transaction; monthly re-derivation job alerts on drift |
| **`cost_at_sale` snapshotted at sale time** | Written once by the sales service; no update path exists; later cost changes never rewrite history |
| **Completed invoices never updated or deleted** | No UPDATE/DELETE code path on `COMPLETED` rows; corrections are `RETURN` / credit-note documents with `original_invoice_id` |
| **`audit_log` / `platform_audit_log` / `price_change_log` / `payment` / `party_ledger_entry` append-only** | `REVOKE UPDATE, DELETE` from the app role; wrong entries are reversed, not edited |
| Retention | Application logs 30 days; `audit_log` per plan, minimum 7 years for financial rows; tenant data export available via `manage.py export_tenant <slug>` |
| Soft delete | `tenant.deleted_at`; master data uses `is_active = false`; rate types are soft-deleted only (historical invoices reference them) |

---

## 13. Relationship map

```
tenant 1─* branch 1─* stock_level *─1 item_variant *─1 item *─1 category (tree)
tenant 1─* user *─* role *─* permission
tenant 1─* rate_type 1─* item_price ─┬─ variant
                                      ├─ item
                                      └─ category
branch 1─* sales_invoice 1─* sales_invoice_item *─1 item_variant
sales_invoice 1─* payment
sales_invoice (RETURN) *─1 sales_invoice (SALE)      [original_invoice_id]
customer 1─* sales_invoice ;  customer 1─* party_ledger_entry
supplier 1─* purchase_invoice 1─* purchase_invoice_item 1─* stock_batch
item_variant 1─* stock_movement   (immutable ledger; stock_level is its projection)
```
