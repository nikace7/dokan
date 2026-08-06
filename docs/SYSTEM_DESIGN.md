# Clothing Shop Management System — System Design

Multi-tenant SaaS for clothing retail in Nepal. Subdomain-per-shop, BS calendar
native, IRD-compliant billing, offline-tolerant POS.

**Status:** Design v1 · **Date:** 2026-07-27

---

## 0. Decision Summary

| Decision | Choice | Why |
|---|---|---|
| Backend | Django 5 + DRF + PostgreSQL 16 | Mature migrations, strong ORM for reporting, batteries for admin/auth. Team can hire for it in Nepal. |
| Tenant isolation | Shared schema + `tenant_id` + **Postgres RLS** | One migration run for all tenants. RLS makes a forgotten `.filter()` structurally unable to leak. |
| Tenant routing | Subdomain → middleware → `SET LOCAL app.tenant_id` | Tenant never comes from a URL path or request body. |
| Frontend | Vite + React + TS, PWA | POS needs offline + instant boot. Next.js SSR buys nothing for an authenticated POS. |
| Dates | Store UTC/AD, **denormalize `business_date_bs` + `fiscal_year_bs`** on every transaction row | Reports become plain indexed `GROUP BY`. No conversion in SQL. |
| Costing | Moving weighted average, `cost_at_sale` snapshotted on every line | Profit reports must not change retroactively. |
| Variants | `Item` → `ItemVariant` (size × color) | Clothing stock is per size/color or it is useless. |
| Invoice numbers | Gapless, row-locked `number_sequence` per branch per fiscal year | IRD requirement. DB sequences leave gaps on rollback. |
| Deploy v1 | Single VPS, Docker Compose, Caddy wildcard TLS | Handles ~300 shops. Kubernetes when it hurts, not before. |

---

## 1. Product Scope — Modules

### 1.1 Core modules (Phase 1)

| Module | Responsibility |
|---|---|
| **Auth & Identity** | Phone-based login, password + optional OTP, sessions, device registration, password reset via SMS. |
| **RBAC** | Permissions catalog, roles, per-branch role assignment, permission checks at API + service + serializer layers. |
| **Tenant Management** | Tenant CRUD, subdomain provisioning, plan assignment, feature limits, suspend/reactivate, trial handling. |
| **Branch (Outlet)** | Multiple physical shops under one tenant. Stock, invoice series, and staff are branch-scoped. |
| **Catalog** | Categories (tree), brands, size charts, items (styles), variants (SKU = size × color), barcodes, images. |
| **Pricing** | Rate types, price resolution chain, min/max selling price guardrails, cost-price visibility control, discount authority. |
| **Stock** | Stock levels, immutable movement ledger, opening stock, adjustments, damage/write-off, transfers, physical count. |
| **Purchasing** | Suppliers, purchase invoices, GRN, landed cost allocation, supplier payables. |
| **Sales / POS** | Fast billing, barcode scan, hold/park bill, split payment, credit (udharo) sale, print/SMS receipt. |
| **Returns & Exchange** | Sales return (credit note), exchange (return + sale pair), restocking rules, return window policy. |
| **Customers** | Customer profile, default rate type, credit limit, party ledger, loyalty points. |
| **Payments** | Cash / eSewa / Khalti / Fonepay QR / card / bank, split tenders, receipts against dues. |
| **Reports** | Daily / monthly / yearly sales, stock summary, low stock, dead stock, profit, returns, dues, VAT registers. |
| **Settings** | Shop profile, PAN/VAT, calendar preference, business-day start, print format, tax config, number series. |
| **Audit Log** | Immutable who-did-what with before/after JSON, including impersonation attribution. |
| **Support Access** | Super-admin time-boxed impersonation into a tenant, reason-required, fully audited, visible banner. |

### 1.2 Modules that make it actually useful (Phase 2–3)

| Module | Why it matters in a real Nepali clothing shop |
|---|---|
| **Udharo / Credit Ledger** | Nepali retail runs on khata. Per-customer and per-supplier running balance with aging. |
| **IRD / CBMS Compliance** | VAT-registered shops legally need approved computerized billing: gapless numbering, no bill deletion (credit notes only), materialized-view log, real-time CBMS sync. |
| **Exchange Flow** | "Size didn't fit" is the #1 counter interaction in clothing. Must be one screen, not two transactions. |
| **Barcode & Price-Tag Printing** | Shops receive unlabelled goods. Generate + print barcode labels and MRP tags in-app. |
| **Size × Color Matrix Entry** | Enter 6 sizes × 4 colors in one grid, not 24 form submissions. Biggest single stock-entry time saver. |
| **Cash Session / Day Close** | Open drawer with float, close with counted cash, system shows variance; POS sale completion requires the branch session to be open. Stops end-of-day arguments. |
| **Ageing / Dead Stock Report** | Clothing rots in value. "Not sold in 90 days" drives the discount decision. |
| **Season & Collection Tagging** | Dashain/Tihar collections, winter/summer, so reports slice by campaign. |
| **Sales Staff Attribution + Commission** | Commission is normal in garment retail; needs per-invoice salesperson. |
| **Festival Campaigns** | Time-boxed discount rules with auto-expiry (Dashain 20% off, ends Kartik 5). |
| **Expense Tracking** | Rent, salary, electricity. Without it "profit" is only gross margin, and the owner will not trust it. |
| **Stock Transfer Between Branches** | Move slow stock from one outlet to another; needs in-transit state. |
| **Offline-First Billing (PWA)** | Load shedding and ISP drops are real. Billing must never stop; queue and sync. |
| **SMS / Viber Receipt** | Cheaper than paper, and gives a customer phone number for marketing. |
| **Alteration / Tailor Jobs** | Track garment sent for alteration with pickup date; common in Nepali clothing shops. |
| **Reorder Suggestions** | Auto purchase list from reorder level + last 30-day velocity. |
| **Loyalty & Birthday/Festival SMS** | Repeat-customer engine, near-zero cost. |

---

## 2. Multi-Tenant Architecture

### 2.1 Isolation model — the choice

| Option | Isolation | Migration cost | Ops cost | Verdict |
|---|---|---|---|---|
| Shared schema, `tenant_id` only | App-enforced (fragile) | 1 run | Low | Rejected — one missing filter = data breach |
| **Shared schema + `tenant_id` + Postgres RLS** | **DB-enforced** | **1 run** | **Low** | **Chosen** |
| Schema per tenant | DB-enforced | N runs (slow past ~300) | Medium | Later, for enterprise tenants only |
| Database per tenant | Total | N runs | High | Only if a customer contractually demands it |

RLS turns tenant isolation from a code-review problem into a database constraint.

```sql
ALTER TABLE sales_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice FORCE  ROW LEVEL SECURITY;   -- applies to table owner too

CREATE POLICY tenant_isolation ON sales_invoice
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Rules:
- App connects as a **non-superuser, non-owner** role. Superuser bypasses RLS silently.
- `FORCE ROW LEVEL SECURITY` is mandatory, otherwise the owning role bypasses policies.
- `WITH CHECK` blocks writing a row into another tenant, not just reading one.
- Migrations run as a separate privileged role that *is* allowed to bypass.
- Platform tables (`tenant`, `plan`, `platform_user`) live outside RLS and are only reachable from the super-admin service.

### 2.2 Request lifecycle

```
shreeganesh.dokan.com.np/api/v1/sales
        │
        ▼
[Caddy]  wildcard TLS *.dokan.com.np  (Let's Encrypt DNS-01)
        │
        ▼
[TenantMiddleware]
   1. parse subdomain            → "shreeganesh"
   2. lookup tenant (Redis, 5min TTL)
   3. reject if status != active → 402 / 423 with a friendly page
   4. open transaction, SET LOCAL app.tenant_id = '<uuid>'
        │
        ▼
[AuthMiddleware]  JWT → user; assert user.tenant_id == request.tenant_id
        │
        ▼
[PlanGate]  feature required by this route enabled on tenant's plan?
        │
        ▼
[DRF Permission]  user has `sale.create`?
        │
        ▼
[Service layer]  business rules (price floor, credit limit, stock)
```

Non-negotiables:
- Tenant is derived **only** from the subdomain. Never from a header, body, or query param.
- A JWT is bound to one tenant. Reusing a token on another subdomain is a hard 403 and an audit event.
- `SET LOCAL` runs inside the request transaction, so it is safe with PgBouncer in **transaction** pooling mode. (Session mode + `SET` would leak across requests — do not.)

### 2.3 Subdomain map

| Host | Serves |
|---|---|
| `www.dokan.com.np` | Marketing site, signup |
| `app.dokan.com.np` | Tenant selector / login redirect |
| `<slug>.dokan.com.np` | Tenant app (shop staff + owner) |
| `admin.dokan.com.np` | Super-admin portal (separate auth realm, IP allowlist, mandatory 2FA) |
| `api.dokan.com.np` | Optional public/integration API |

Reserved slugs blocklist: `www, app, api, admin, mail, static, cdn, blog, help, status, staging`. Slug rules: 3–30 chars, `[a-z0-9-]`, immutable after creation (changing it breaks bookmarks, cached QR codes, and printed receipts). Custom domains (`billing.myshop.com.np`) are a Phase 3 add-on with per-domain cert issuance.

### 2.4 Actor model

| Actor | Lives in | Scope | Notes |
|---|---|---|---|
| **Super Admin** | `platform_user` | All tenants | Full platform control, billing, plan changes, impersonation with write scope. |
| **Support Agent** | `platform_user` | All tenants, read-mostly | Impersonate read-only by default; write requires a super-admin-approved elevation. |
| **Tenant Owner** | `user` | One tenant | Sees cost price and profit. Only role that can change min/max price and manage users. |
| **Manager** | `user` | One or more branches | Everything operational; cost price optional per tenant setting. |
| **Cashier** | `user` | One branch | Billing, returns within window, no cost, capped discount. |
| **Stock Keeper** | `user` | One branch | Purchase entry, stock adjust, transfers. No sales, no pricing. |
| **Accountant** | `user` | Tenant-wide, read | Reports, ledgers, VAT registers, expenses. No stock/price edits. |

Platform users and tenant users are **separate tables with separate token audiences**. A super admin never gets a row in a tenant's `user` table. This prevents the classic "support account left behind after offboarding" hole.

### 2.5 Plan limits & feature gating

`plan.limits` (JSONB), `plan.features` (JSONB), overridable per tenant via `tenant_feature_override`:

```jsonc
{
  "limits": {
    "max_users": 5, "max_branches": 1, "max_items": 2000,
    "max_invoices_per_month": 3000, "storage_mb": 500,
    "sms_credits_per_month": 100, "data_retention_years": 7
  },
  "features": {
    "multi_branch": false, "custom_rate_types": true, "max_rate_types": 3,
    "vat_module": false, "ird_sync": false, "sms": true, "loyalty": false,
    "api_access": false, "offline_pos": true, "barcode_printing": true,
    "profit_reports": true, "export_excel": true
  }
}
```

Enforcement policy — **never break a shop mid-sale**:

| Limit type | Behaviour at limit |
|---|---|
| Creation limits (users, items, branches) | Hard block at create with a clear upgrade CTA. |
| Volume limits (invoices/month) | Soft: warn at 80%, warn harder at 100%, keep billing working, flag account for sales follow-up. |
| Feature flags | Route returns 402 + UI hides/locks the nav item with an "Upgrade" tag. |
| Storage | Block new uploads, keep existing readable. |

A nightly job reconciles actual usage vs. limits and writes `tenant_usage_snapshot` for the super-admin dashboard and for billing.

### 2.6 Support access (impersonation) — security-critical

Flow:
1. Super admin opens tenant in admin portal → **"Support Login"**.
2. Modal requires: **reason text (min 20 chars)**, target user, scope (`read_only` default / `read_write`), duration (15/30/60 min max).
3. System writes `impersonation_session`, issues a short-lived token with claims:
   `{sub: <tenant_user_id>, tenant: <id>, act: <platform_user_id>, scope: "read_only", exp: <=60min}`
4. Tenant UI renders a **persistent red banner**: "Support session active — Ram Sharma (Support). Ends 14:32. [End now]".
5. Tenant owner receives an email/SMS notification at session start.
6. Every write during the session stamps `audit_log.impersonated_by`.
7. Blocked during impersonation regardless of scope: change passwords, create/delete users, change plan/billing, export full customer database, delete tenant, disable audit log.
8. Session auto-expires; the token is also invalidated server-side (jti denylist in Redis) so "end now" is instant.
9. Tenant owner can view a **Support Access Log** page themselves — trust is built by showing them, not by promising.

---

## 3. Data Model

### 3.1 Platform scope (no RLS, super-admin service only)

```
plan(id, code, name, price_npr, billing_cycle, limits jsonb, features jsonb,
     is_active, sort_order)

tenant(id, slug UNIQUE, name, name_np, legal_name, pan_vat_no, vat_registered,
       plan_id → plan, status[TRIAL|ACTIVE|PAST_DUE|SUSPENDED|CANCELLED],
       trial_ends_at, timezone='Asia/Kathmandu', calendar_pref[BS|AD|BOTH],
       locale[np|en], onboarded_at, created_at, deleted_at)

tenant_subscription(id, tenant_id, plan_id, period_start, period_end,
                    amount_npr, status, payment_ref, invoice_url)

tenant_feature_override(id, tenant_id, key, value jsonb, expires_at, note)

tenant_usage_snapshot(id, tenant_id, date, users, items, invoices_mtd,
                      storage_mb, sms_used)

platform_user(id, email UNIQUE, password_hash, full_name, role[SUPER_ADMIN|SUPPORT|BILLING],
              totp_secret, is_active, last_login_at)

impersonation_session(id, platform_user_id, tenant_id, target_user_id, reason,
                      scope[READ_ONLY|READ_WRITE], ip, user_agent,
                      started_at, expires_at, ended_at, ended_by)

platform_audit_log(id, platform_user_id, action, tenant_id, payload jsonb, ip, created_at)
```

### 3.2 Tenant scope (every table has `tenant_id`, all RLS-protected)

**Identity & structure**

```
branch(id, tenant_id, code, name, name_np, address, phone, invoice_prefix,
       is_default, is_active)

user(id, tenant_id, phone UNIQUE(tenant_id,phone), email, password_hash,
     full_name, is_active, must_change_password, last_login_at,
     failed_login_count, locked_until)

role(id, tenant_id, code, name, name_np, is_system, description)
permission(code PK, module, name, description, is_sensitive)     -- global catalog
role_permission(role_id, permission_code)
user_role(id, tenant_id, user_id, role_id, branch_id NULL)       -- NULL = all branches
```

**Catalog**

```
category(id, tenant_id, parent_id → category, name, name_np, size_chart_id,
         default_margin_pct, min_price_pct, max_price_pct, sort_order, is_active)

brand(id, tenant_id, name, is_active)

size_chart(id, tenant_id, name, values text[] ORDERED)   -- ['S','M','L','XL'] | ['28','30','32']

item(id, tenant_id, code UNIQUE(tenant_id,code), name, name_np,
     category_id, brand_id, size_chart_id, gender[M|F|U|KIDS], season,
     collection_tag, hsn_code, unit='PCS', is_vat_applicable,
     images jsonb, attributes jsonb,                     -- fabric, fit, care, etc.
     min_selling_price, max_selling_price, reorder_level,
     is_active, created_by, created_at)

item_variant(id, tenant_id, item_id, size, color, color_hex,
             sku UNIQUE(tenant_id,sku), barcode UNIQUE(tenant_id,barcode),
             mrp, min_selling_price NULL, max_selling_price NULL,
             avg_cost,                                    -- moving weighted average
             is_active,
             UNIQUE(item_id, size, color))
```

> `attributes jsonb` is the deliberate escape hatch instead of a full EAV table.
> Clothing needs size + colour as first-class columns and everything else is
> descriptive. EAV here would buy flexibility nobody uses and cost every query.

**Pricing**

```
rate_type(id, tenant_id, code, name, name_np, is_default, sort_order,
          default_margin_pct, required_permission NULL, is_active)

item_price(id, tenant_id, rate_type_id,
           scope[VARIANT|ITEM|CATEGORY],
           variant_id NULL, item_id NULL, category_id NULL,
           price, effective_from, effective_to NULL,
           created_by, created_at)
   INDEX (tenant_id, rate_type_id, scope, variant_id, item_id, category_id, effective_from)

price_change_log(id, tenant_id, target_type, target_id, rate_type_id,
                 old_price, new_price, changed_by, reason, created_at)
```

**Inventory**

```
stock_level(id, tenant_id, branch_id, variant_id, qty_on_hand, qty_reserved,
            avg_cost, updated_at, UNIQUE(branch_id, variant_id))    -- projection

stock_movement(id, tenant_id, branch_id, variant_id,
               type[OPENING|PURCHASE|SALE|SALE_RETURN|PURCHASE_RETURN|
                    TRANSFER_IN|TRANSFER_OUT|ADJUSTMENT|DAMAGE|COUNT],
               qty_delta, unit_cost, balance_after,
               ref_type, ref_id, note,
               business_date_ad, business_date_bs, fiscal_year_bs,
               created_by, created_at)                              -- IMMUTABLE LEDGER

stock_batch(id, tenant_id, branch_id, variant_id, purchase_item_id,
            qty_in, qty_remaining, unit_cost, landed_cost, received_at)

stock_transfer(id, tenant_id, from_branch_id, to_branch_id, status[DRAFT|SENT|RECEIVED|CANCELLED],
               sent_at, received_at, created_by, note)
stock_transfer_item(id, transfer_id, variant_id, qty_sent, qty_received)

stock_count(id, tenant_id, branch_id, status, started_at, finalized_at, created_by)
stock_count_item(id, count_id, variant_id, system_qty, counted_qty, variance, note)
```

**Purchasing**

```
supplier(id, tenant_id, name, phone, pan_no, address, opening_balance,
         credit_days, is_active)

purchase_invoice(id, tenant_id, branch_id, supplier_id, invoice_no,
                 supplier_bill_no, bill_date_ad, bill_date_bs, fiscal_year_bs,
                 subtotal, discount, taxable_amount, vat_amount, other_charges,
                 total, paid_amount, due_amount, status[DRAFT|CONFIRMED|CANCELLED],
                 note, created_by, created_at)

purchase_invoice_item(id, purchase_invoice_id, variant_id, qty, unit_cost,
                      discount, line_total)
```

**Sales**

```
customer(id, tenant_id, name, phone UNIQUE(tenant_id,phone), address,
         default_rate_type_id → rate_type, credit_limit, opening_balance,
         loyalty_points, birthday_bs, gender, note, is_active, created_at)

sales_invoice(id, tenant_id, branch_id,
              invoice_no UNIQUE(tenant_id, branch_id, fiscal_year_bs, invoice_no),
              doc_type[SALE|RETURN|EXCHANGE_OUT],
              original_invoice_id NULL, exchange_group_id NULL,
              customer_id NULL, rate_type_id, salesperson_id NULL,
              subtotal, discount_amount, discount_reason, discount_approved_by NULL,
              taxable_amount, vat_amount, round_off, total,
              paid_amount, due_amount,
              status[HELD|COMPLETED|CANCELLED],
              is_vat_bill, print_count, ird_synced_at NULL, ird_sync_error NULL,
              datetime_ad, business_date_ad, business_date_bs, fiscal_year_bs,
              device_id, idempotency_key UNIQUE(tenant_id, idempotency_key),
              created_by, created_at)

sales_invoice_item(id, sales_invoice_id, variant_id, qty,
                   rate_type_id, unit_price, discount, line_total,
                   cost_at_sale,              -- SNAPSHOT. never recompute.
                   returned_qty)

payment(id, tenant_id, branch_id, direction[IN|OUT],
        party_type[CUSTOMER|SUPPLIER|NONE], party_id NULL,
        method[CASH|ESEWA|KHALTI|FONEPAY|QR|CARD|BANK|CREDIT|POINTS],
        amount, ref_no, sales_invoice_id NULL, purchase_invoice_id NULL,
        business_date_ad, business_date_bs, fiscal_year_bs, created_by, created_at)

party_ledger_entry(id, tenant_id, party_type, party_id, ref_type, ref_id,
                   debit, credit, balance_after, narration,
                   business_date_bs, created_at)

held_bill(id, tenant_id, branch_id, label, cart jsonb, created_by, created_at)
```

**Operations**

```
cash_session(id, tenant_id, branch_id, opened_by, opened_at, opening_float,
             closed_by, closed_at, counted_cash, expected_cash, variance, note)

expense(id, tenant_id, branch_id, category_id, amount, method, note,
        business_date_bs, created_by, attachment_url)

number_sequence(id, tenant_id, branch_id, doc_type, fiscal_year_bs,
                prefix, next_number, UNIQUE(tenant_id,branch_id,doc_type,fiscal_year_bs))

tenant_setting(id, tenant_id, key, value jsonb)

audit_log(id, tenant_id, user_id NULL, impersonated_by NULL, action, entity,
          entity_id, before jsonb, after jsonb, ip, user_agent, created_at)

sms_log(id, tenant_id, to_phone, template, body, provider, status, cost, created_at)
```

### 3.3 Relationship map

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

### 3.4 Index plan (the ones that decide whether this is fast)

```sql
CREATE UNIQUE INDEX ON item_variant (tenant_id, barcode) WHERE barcode IS NOT NULL; -- hottest lookup
CREATE INDEX ON item_variant (tenant_id, sku);
CREATE INDEX ON sales_invoice (tenant_id, branch_id, business_date_bs);
CREATE INDEX ON sales_invoice (tenant_id, fiscal_year_bs, doc_type);
CREATE INDEX ON sales_invoice (tenant_id, customer_id, created_at DESC);
CREATE INDEX ON sales_invoice (tenant_id, due_amount) WHERE due_amount > 0;         -- partial
CREATE INDEX ON sales_invoice_item (sales_invoice_id);
CREATE INDEX ON sales_invoice_item (variant_id, sales_invoice_id);
CREATE INDEX ON stock_movement (tenant_id, variant_id, created_at DESC);
CREATE INDEX ON stock_movement (tenant_id, branch_id, business_date_bs);
CREATE INDEX ON stock_level (tenant_id, branch_id) WHERE qty_on_hand <= 0;
CREATE INDEX ON party_ledger_entry (tenant_id, party_type, party_id, created_at);
CREATE INDEX ON item USING gin (to_tsvector('simple', name || ' ' || code));        -- search
```

Every composite index leads with `tenant_id` so RLS predicates are index-covered.

### 3.5 Three invariants that must never be violated

1. **Stock changes only via `stock_movement`.** `stock_level` is written by the same transaction as a projection. A monthly job re-derives `stock_level` from the ledger and alerts on drift.
2. **`cost_at_sale` is snapshotted at sale time.** Cost changes later must not rewrite history.
3. **Completed invoices are never updated or deleted.** Corrections happen through a `RETURN` / credit note. This is both an accounting and an IRD requirement.

---

## 4. Pricing & Rate Rules

### 4.1 Concepts

| Field | Where | Who sees it |
|---|---|---|
| `avg_cost` / `unit_cost` | `item_variant`, `stock_batch` | `pricing.view_cost` permission only |
| `mrp` | `item_variant` | Everyone (printed on tag) |
| `price` per rate type | `item_price` | Everyone who can bill |
| `min_selling_price` | `item_variant` → `item` → `category` | Owner/Manager sets; enforced for everyone |
| `max_selling_price` | same chain | Owner/Manager sets; enforced for everyone |
| `cost_at_sale` | `sales_invoice_item` | Profit reports only |

### 4.2 Price resolution (deterministic, first hit wins)

```
resolve_price(variant, rate_type, qty, customer, date):
  1. item_price WHERE scope=VARIANT  AND variant_id=v  AND rate_type=r AND active_on(date)
  2. item_price WHERE scope=ITEM     AND item_id=v.item AND rate_type=r AND active_on(date)
  3. item_price WHERE scope=CATEGORY AND category_id ∈ ancestors(v.item.category)   -- nearest first
                                     AND rate_type=r AND active_on(date)
  4. derived:  variant.avg_cost × (1 + rate_type.default_margin_pct/100)
  5. fail → 409 PRICE_NOT_SET  (never silently fall back to MRP or 0)
```

`active_on(date)` = `effective_from <= date AND (effective_to IS NULL OR effective_to >= date)`.
Ties broken by most recent `effective_from`. The whole chain resolves in one query with a
`CASE` priority ordering; results are cached in Redis per `(tenant, rate_type, variant)`
with invalidation on any `item_price` write.

### 4.3 Min / max guardrails

Effective bounds also resolve nearest-first: `variant → item → category`. Category-level
bounds may be expressed as percentages of cost (`min_price_pct`, `max_price_pct`) so a
whole category can be governed with one setting.

At billing time:

| Condition | Behaviour |
|---|---|
| `price < effective_min` and user lacks `pricing.override_min` | **Block.** "Minimum price is Rs. 850." |
| `price < effective_min` and user has `pricing.override_min` | Allow with a required reason; log to `price_change_log`; flag invoice for review. |
| `price < effective_min` and setting `require_manager_approval` | In-app approval request; manager PIN on the same screen. |
| `price > effective_max` | Block always. Overcharging is a reputational risk, not a business decision. |
| `price < avg_cost` and user has `pricing.view_cost` | Warn: "Below cost by Rs. 120. Continue?" |
| `price < avg_cost` and user lacks `pricing.view_cost` | Silent block via the min-price floor. Never reveal cost through an error message. |

> **Leak rule:** error messages, validation hints, and API error payloads must never
> contain cost figures for users without `pricing.view_cost`. A "below cost" message is
> itself a cost disclosure.

### 4.4 Discounts

Discount is applied *after* rate resolution and is bounded by the same min-price floor.

```
role_discount_limit(role, category?) → max_percent
final_price = resolved_price × (1 − discount_pct/100)
assert final_price >= effective_min_price
```

Defaults: Cashier 5%, Manager 20%, Owner unlimited. Bill-level discount is distributed
proportionally across lines so per-line margin stays computable.

### 4.5 Dynamic rate types

Super admin controls **how many** rate types a tenant may have (`features.max_rate_types`).
The tenant owner creates and names them (`Thok` / wholesale, `Khudra` / retail, `Member`,
`VIP`, `Sale Rate`). Rules:

- Exactly one `is_default = true` per tenant.
- A rate type may carry `required_permission` — e.g. only Manager+ can bill at `Thok`.
- `customer.default_rate_type_id` auto-selects the rate when a customer is attached.
- Rate types are **soft-deleted only** (`is_active = false`). Historical invoices reference them.
- Bulk price entry screen: pick a rate type + category → grid of items with an editable
  price column and a "set all to cost + X%" helper.

### 4.6 Cost-price visibility — enforced in three places

1. **Serializer:** `cost`, `avg_cost`, `margin`, `profit` fields are dropped from the payload unless the requesting user has `pricing.view_cost`. Field-level, not object-level.
2. **Selector/queryset:** report selectors do not even `SELECT` cost columns for unprivileged users, so cost never enters application memory.
3. **UI:** components are not rendered, not merely hidden with CSS.

Toggle `tenant_setting.manager_can_view_cost` lets an owner decide whether Managers see it.
Default: **off**.

---

## 5. Reports

### 5.1 Report catalog

| Report | Grouping | Key columns | Permission |
|---|---|---|---|
| **Daily Sales** | `business_date_bs` | bills, gross, discount, VAT, net, cash/digital/credit split, returns | `report.sales` |
| **Monthly Sales** | BS month | per-day rows + totals, vs. last month | `report.sales` |
| **Yearly / Fiscal** | `fiscal_year_bs` | per-month rows, Shrawan→Ashad | `report.sales` |
| **Sales by Item / Variant** | variant | qty, revenue, margin, return rate | `report.sales` |
| **Size & Colour Matrix** | size × colour | qty sold heatmap per item/category | `report.sales` |
| **Sales by Staff** | salesperson | bills, revenue, avg bill, discount given, commission | `report.staff` |
| **Hourly Heatmap** | hour × weekday | bill count | `report.sales` |
| **Stock Summary** | branch, category | qty on hand, stock value @ cost, @ retail | `report.stock` |
| **Low Stock** | variant | on hand, reorder level, 30-day velocity, suggested order qty | `report.stock` |
| **Dead / Ageing Stock** | variant | days since last sale, qty, locked capital | `report.stock` |
| **Stock Movement Ledger** | variant | full audit trail with running balance | `report.stock` |
| **Profit Estimate** | period, category, item | revenue − Σ`cost_at_sale` = gross; − expenses = net | `report.profit` **+** `pricing.view_cost` |
| **Returns** | period, reason | qty, value, % of sales, top returned items | `report.sales` |
| **Receivables (Udharo)** | customer | balance, aging 0–30/31–60/61–90/90+, last payment | `report.ledger` |
| **Payables** | supplier | balance, aging, due date | `report.ledger` |
| **Cash Book / Day Close** | date, session | opening, cash in, cash out, expected, counted, variance | `report.cash` |
| **VAT Sales Register** | BS month | IRD-format sales register | `report.vat` |
| **VAT Purchase Register** | BS month | IRD-format purchase register | `report.vat` |
| **Expenses** | category, BS month | amount, % of revenue | `report.expense` |

### 5.2 Reporting architecture — staged, not over-built

**Phase 1 — query the OLTP directly.**
Every report is a `selectors.py` function returning an aggregate queryset, filtered on
`(tenant_id, branch_id, business_date_bs BETWEEN ?, ?)`. With the indexes in §3.4 a shop
doing 200 bills/day queries a full year in well under 200 ms. Do not build a warehouse yet.

**Phase 2 — nightly rollups when a tenant crosses ~100k invoice lines.**

```
daily_sales_summary(tenant_id, branch_id, business_date_bs, fiscal_year_bs,
                    bill_count, gross, discount, vat, net, cogs, gross_profit,
                    return_count, return_value, cash, digital, credit)
                    PRIMARY KEY (tenant_id, branch_id, business_date_bs)

daily_item_summary(tenant_id, branch_id, business_date_bs, variant_id,
                   qty_sold, revenue, cogs)
```

Rebuilt by a Celery job at the tenant's `day_start_time + 1h`, plus an idempotent
`rebuild_summary(tenant, date_range)` command for corrections. Reports read the summary for
closed days and the live tables for today, then union.

**Phase 3 —** read replica for reporting, and Postgres partitioning of `sales_invoice`
and `stock_movement` by `fiscal_year_bs` when the largest tenant passes ~5M rows.

### 5.3 Report UX rules

- Every report opens on a **sensible default** (today for daily, current BS month for monthly). Never an empty screen with a blank date filter.
- Presets first, custom range second: `आज · हिजो · यो हप्ता · यो महिना · गएको महिना · यो आ.व.`
- Every report exports to Excel (`.xlsx`) and prints to A4 and 80mm thermal.
- Every report shows the same 4 numbers in the same place in the header, so the owner learns one layout.
- Numbers formatted Nepali style: `१,२३,४५६` / `1,23,456` (lakh grouping), not `123,456`.
- Long reports are generated async via Celery with a download link — never a 60-second hanging request.

---

## 6. Nepali BS Date Support

### 6.1 Storage rules

| Rule | Reason |
|---|---|
| `created_at`, `datetime_ad` stored as `timestamptz` (UTC) | Single source of truth; no ambiguity. |
| `business_date_ad` stored as `date` | The shop's operating day, derived from `datetime_ad` and `day_start_time`. |
| `business_date_bs` stored as `char(10)` `'2082-04-12'` | Zero-padded, lexicographically sortable, directly indexable, `BETWEEN`-comparable. |
| `fiscal_year_bs` stored as `char(7)` `'2082-83'` | Nepali FY = Shrawan 1 → Ashad end. Needed for VAT and invoice numbering. |
| **Never** store BS as the only value | Conversion tables change; AD is the anchor. |

All three denormalized fields are computed once in the service layer at write time. This is
the single decision that makes BS reporting fast — every report becomes
`WHERE business_date_bs BETWEEN '2082-04-01' AND '2082-04-32'`, a plain index range scan.

### 6.2 Business day boundary

A sale rung at 23:40 belongs to which day? The shopkeeper's answer is "today", even if the
clock rolled over. So:

```
tenant_setting.day_start_time  (default '00:00', typical shops set '04:00')
business_date_ad = (datetime_ad AT TIME ZONE 'Asia/Kathmandu' - day_start_time).date()
```

Set it once at onboarding. Changing it later does **not** rewrite history — an audit note records the change date.

### 6.3 Conversion layer

| Layer | Library | Notes |
|---|---|---|
| Backend | `nepali-datetime` (Python) | Wrap it in `core/calendar/bs.py`. Never call it directly from views. |
| Frontend | `nepali-date-converter` (TS) | Same conversion table version pinned as the backend. |

Wrapper contract:

```python
# core/calendar/bs.py
def ad_to_bs(d: date) -> BSDate                  # raises OutOfRangeError
def bs_to_ad(bs: str | BSDate) -> date
def bs_fiscal_year(bs: BSDate) -> str            # '2082-83', Shrawan 1 boundary
def bs_month_range(year: int, month: int) -> tuple[date, date]
def format_bs(bs: BSDate, locale: str, numerals: str) -> str
SUPPORTED_RANGE = (BS 1970-01-01, BS 2100-12-30)
```

Rules:
- Conversion happens **only** in this module. Grep for the library name should return one file.
- Out-of-range input is a validation error with a clear message, never a silent wrong date.
- A golden-file test asserts ~500 known AD↔BS pairs including every leap-ish year and every month-length variation. This is the test that catches library upgrades breaking dates.
- Both backend and frontend run the **same** golden fixture file, so they can never disagree.

### 6.4 Display & input

- `tenant.calendar_pref`: `BS` (default) / `AD` / `BOTH`. In `BOTH`, the primary is BS and AD shows as small grey secondary text.
- Date picker: BS calendar grid with Nepali month names (बैशाख, जेठ, असार, साउन, भदौ, असोज, कार्तिक, मंसिर, पुष, माघ, फागुन, चैत), Nepali weekday initials, today highlighted, and correct month lengths (29–32 days — a generic 30/31 picker is wrong).
- Above the grid: preset chips — `आज · हिजो · यो हप्ता · यो महिना · गएको महिना · यो आ.व.`
- Keyboard entry accepts `2082/04/12`, `2082-04-12`, `82/4/12`.
- Numerals toggle: Devanagari (`२०८२`) or Arabic (`2082`) per user preference; Devanagari default for `locale=np`.
- Receipts print BS prominently and AD in small text (some B2B customers need AD).
- API always exchanges **AD ISO strings** (`2025-07-27`). BS is a presentation and reporting concern. Report endpoints additionally accept `date_from_bs` / `date_to_bs` and convert at the boundary.

---

## 7. UI/UX Plan

### 7.1 Principles

1. **One primary action per screen**, as a large button, in the same corner every time.
2. **Three clicks maximum** from dashboard to any task.
3. **Big touch targets** (min 44×44 px) — staff use tablets with dry or gloved hands.
4. **Nepali + English labels** side by side for the first month, then per-user preference.
5. **No jargon.** "Stock" not "Inventory Ledger". "Baki" not "Accounts Receivable".
6. **Undo over confirm.** Confirm dialogs only where undo is impossible.
7. **Errors say what to do**, not what went wrong. "Yo item ko rate set garnu hos" + a button that opens the price screen.

### 7.2 Dashboard

```
┌──────────────────────────────────────────────────────────────┐
│  श्री गणेश वस्त्रालय        Shrawan 12, 2082      [Ram ▾]     │
├──────────────────────────────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐     │
│  │ आजको बिक्री│ │ आजको नाफा │ │ बाँकी रकम │ │ कम स्टक   │     │
│  │ Rs 45,200 │ │ Rs 11,300 │ │ Rs 82,500 │ │  14 items │     │
│  │  ▲ 12%    │ │ owner only│ │ 23 grahak │ │  हेर्नुहोस्→│     │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Last 30 days sales                        ▁▃▅▂▇▆▃▅▇  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┏━━━━━━━━━━━━┓ ┌───────────┐ ┌───────────┐ ┌───────────┐    │
│  ┃ ➕ नयाँ बिल ┃ │ 📦 स्टक   │ │ 📊 रिपोर्ट│ │ 👥 ग्राहक │    │
│  ┗━━━━━━━━━━━━┛ └───────────┘ └───────────┘ └───────────┘    │
│                                                              │
│  Recent bills                                    हेर्नुहोस् → │
│  INV-1042  Sita Rai      Rs 3,400  Cash    2 min ago         │
└──────────────────────────────────────────────────────────────┘
```

Tiles are role-filtered. A cashier sees two tiles and one button. Nothing else on this screen — no widgets, no news feed, no settings shortcuts.

### 7.3 Billing screen (the screen that decides the product)

```
┌──────────────────────────────────────────────────────────────────┐
│ नयाँ बिल   INV-1043          Rate: [खुद्रा ▾]   ग्राहक: [+ थप्नु]│
├───────────────────────────────────────────┬──────────────────────┤
│ 🔍 Barcode scan / नाम टाइप गर्नुहोस्       │  Items          3    │
│ ─────────────────────────────────────────  │  Sub total  4,050    │
│                                            │  Discount     150    │
│ # Item              Size Qty  Rate  Total │  ─────────────────   │
│ 1 Cotton Shirt Blue  L   1   1,200 1,200  │  TOTAL      3,900    │
│ 2 Denim Jeans        32  1   2,200 2,200  │                      │
│ 3 Socks Black        F   2     325   650  │  [ नगद ] [ QR ]      │
│                                            │  [ कार्ड ] [ उधारो ] │
│                                            │                      │
│                                            │  ┏━━━━━━━━━━━━━━━━┓  │
│ [F3] Hold   [F4] Customer   [F7] Discount │  ┃ F9 सेभ + प्रिन्ट┃  │
└────────────────────────────────────────────┴──━━━━━━━━━━━━━━━━━──┘
```

Interaction contract:
- Search box is **auto-focused on load and re-focused after every line add**. A barcode scanner is a keyboard; scan → line added → cursor back in the box. Zero mouse for a whole bill.
- Typing 3+ characters searches name / code / SKU with debounce; arrow keys + Enter select.
- Qty defaults to 1. `*` then a number sets qty inline (`*3` = qty 3), like every POS staff have used.
- If a variant has one size and one colour, it adds directly. If multiple, a compact size/colour chip picker appears inline — never a modal.
- Out-of-stock shows a red qty and a warning; `tenant_setting.allow_negative_stock` decides block vs. warn. Default **warn**, because the garment is physically in the customer's hand.
- Split payment: tap two methods, the second auto-fills the remainder.
- `Udharo` requires a customer and checks `credit_limit`; over limit needs manager approval.
- F9 saves + prints. Print preview is skipped by default (setting).
- The whole screen works at 1024×768 and on a 10" tablet.

### 7.4 Stock entry — the size × colour matrix

```
Item: Cotton Shirt          Category: Shirts        Supplier: [Kalimati ▾]

           S     M     L    XL   XXL         Cost/pc: [ 720 ]
  Blue  [ 5 ] [10 ] [12 ] [ 8 ] [ 3 ]        Retail : [1200 ]
  White [ 4 ] [ 8 ] [10 ] [ 6 ] [ 2 ]        Wholesale:[ 950 ]
  Black [ 6 ] [12 ] [15 ] [10 ] [ 4 ]

  Total: 148 pcs   Value: Rs 1,06,560        [ 🖨 Print labels ]  [ Save ]
```

Tab moves across, Enter moves down. One save creates 15 variants, 15 stock movements, and one purchase invoice. This screen alone is worth the product to a shop receiving 40 styles a season.

### 7.5 Search

One search box, everywhere, matching: barcode (exact) → SKU → item code → name (EN) → name (NP) → customer phone → invoice number. Ranked, debounced 200 ms, `pg_trgm` for typo tolerance. Recent items appear before typing.

### 7.6 Mobile

- Bottom tab bar: `घर · बिल · स्टक · रिपोर्ट · अरू`
- Billing is fully usable on a phone (owner checks a price while on the shop floor).
- Reports are card-stacked, not horizontally scrolling tables.
- Camera-as-barcode-scanner for phones without hardware scanners.
- PWA installable; works offline for billing and item lookup.

### 7.7 Low-training workflow

| Aid | Detail |
|---|---|
| Guided onboarding | 5 steps: shop details → first category → first item → first rate → first bill. Progress bar, skippable, resumable. |
| Sample data | One-click demo dataset the owner can wipe, so training happens on fake bills. |
| Inline help | `?` icon on any field opens a 2-line explanation in Nepali. |
| Empty states | Every empty list has one sentence and one button, never a blank table. |
| Print-friendly cheat sheet | Auto-generated A4 PDF of keyboard shortcuts to tape to the counter. |
| Role-based nav | A cashier's sidebar has 3 items. Complexity scales with role, not with the product. |

---

## 8. Architecture & Code Structure

### 8.1 Backend layering

```
HTTP  →  urls  →  view (thin)  →  service (writes) / selector (reads)  →  model
                       ↑                    ↑
                  serializer          domain rules, transactions
```

Rules:
- **Views** parse, authorize, and delegate. No business logic, no ORM writes.
- **Services** own transactions and invariants. A sale is one service function, one transaction: reserve stock → write movements → write invoice → write ledger → write payment → bump sequence.
- **Selectors** own reads and reporting queries. They take an explicit `user` argument so cost columns can be dropped at the source.
- **Serializers** validate shape only. Business validation lives in services (serializers can't see the transaction).
- **Models** hold fields, constraints, and trivial computed properties. No fat models.

### 8.2 Folder structure

```
backend/
├── config/
│   ├── settings/{base,dev,prod,test}.py
│   ├── urls.py  asgi.py  celery.py
├── core/
│   ├── calendar/bs.py              # the only place BS conversion exists
│   ├── db/rls.py                   # SET LOCAL app.tenant_id helpers
│   ├── middleware/{tenant,audit,plan_gate}.py
│   ├── permissions/{catalog.py,drf.py}
│   ├── money.py                    # Decimal money, rounding, Nepali formatting
│   ├── numbering.py                # gapless sequences
│   ├── exceptions.py  pagination.py  responses.py
│   └── models.py                   # TenantScopedModel, TimestampedModel
├── apps/
│   ├── tenants/          # tenant, plan, subscription, provisioning
│   ├── platformadmin/    # super admin API, impersonation
│   ├── accounts/         # user, role, permission, auth
│   ├── catalog/          # category, brand, item, variant, size chart
│   ├── pricing/          # rate_type, item_price, resolution engine
│   ├── inventory/        # stock level, movement, transfer, count
│   ├── purchasing/       # supplier, purchase invoice
│   ├── sales/            # invoice, return, exchange, held bill
│   ├── customers/        # customer, loyalty, party ledger
│   ├── payments/         # payment, gateways, cash session
│   ├── expenses/
│   ├── reports/          # selectors + rollup jobs only, no models except summaries
│   ├── audit/
│   ├── notifications/    # SMS, email, templates
│   └── compliance/       # IRD/CBMS sync
└── tests/
    ├── test_tenant_isolation.py    # loops EVERY model, asserts cross-tenant denial
    ├── factories/
    └── fixtures/bs_golden.json
```

Each app: `models.py · services.py · selectors.py · serializers.py · views.py · urls.py · permissions.py · admin.py · tasks.py · tests/`.

Files stay under 400 lines. When `sales/services.py` grows, it becomes
`sales/services/{create_sale,void_sale,returns,exchange}.py` — split by use case, not by layer.

### 8.3 Frontend structure

```
frontend/src/
├── app/                    # router, providers, error boundary
├── features/
│   ├── billing/            # POS — the most optimised feature in the app
│   ├── catalog/  inventory/  purchasing/  customers/
│   ├── reports/  settings/  admin/          # admin/ = super-admin route tree
├── components/ui/          # Button, Input, DataTable, Money, BSDatePicker, Modal
├── lib/
│   ├── api/                # generated typed client from OpenAPI
│   ├── bs/                 # BS conversion + formatting (mirrors backend contract)
│   ├── offline/            # Dexie queue, sync engine, conflict policy
│   ├── permissions.ts      # <Can perm="pricing.view_cost">
│   └── money.ts            # Nepali lakh grouping, Devanagari numerals
├── hooks/  stores/         # TanStack Query (server), Zustand (cart/UI)
└── styles/tokens.css
```

Super admin ships in the same build under an `/admin` route tree, mounted only on the
`admin.` host. One deploy, one auth library, no duplicated design system.

### 8.4 API design

```
Base:  https://<slug>.dokan.com.np/api/v1
Auth:  Authorization: Bearer <jwt>          (access 30 min, refresh 30 days, rotating)
Tenant: from Host header only.
```

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` `/auth/refresh` `/auth/logout` | Phone + password |
| `GET/POST` | `/items` `/items/{id}` | `?search=&category=&is_active=` |
| `GET` | `/items/lookup?barcode=` | Single-purpose, cached, the POS hot path |
| `GET/POST` | `/items/{id}/variants` | |
| `GET/POST` | `/rate-types` `/prices` `/prices/bulk` | |
| `GET` | `/stock?branch=&low=true` | |
| `POST` | `/stock/adjustments` `/stock/transfers` `/stock/counts` | |
| `GET/POST` | `/purchases` | |
| `POST` | `/sales` | **Requires `Idempotency-Key` header** |
| `POST` | `/sales/{id}/returns` `/sales/{id}/exchange` | |
| `GET` | `/sales?date_from_bs=&date_to_bs=&branch=` | |
| `GET/POST` | `/customers` `/customers/{id}/ledger` | |
| `POST` | `/payments` | |
| `GET` | `/reports/{slug}?...` | Large ones return `202 + job_id` |
| `POST` | `/sync/batch` | Offline queue drain, array of idempotent ops |

Super admin (`admin.` host only): `/api/v1/admin/tenants`, `/plans`, `/tenants/{id}/impersonate`, `/tenants/{id}/usage`, `/audit`.

Conventions:
- Envelope: `{ "data": ..., "meta": {...}, "error": null }`; errors `{ "data": null, "error": { "code": "PRICE_BELOW_MINIMUM", "message": "...", "field": "unit_price", "details": {...} } }`. Machine-readable `code` always, because the UI must react differently to `PRICE_BELOW_MINIMUM` vs `CREDIT_LIMIT_EXCEEDED`.
- Cursor pagination on transaction lists, page/limit on catalog.
- `Idempotency-Key` on `POST /sales` and `POST /payments` is **mandatory** — a double-tap on a flaky connection must not create two bills. Key is stored on the invoice and unique per tenant; a replay returns the original invoice with `200`.
- OpenAPI 3.1 generated from DRF, typed TS client generated from that. No hand-written API types.
- Rate limit: 300 req/min/user, 60/min on auth, 20/min on report generation.

### 8.5 Permission system

```python
# core/permissions/catalog.py — single source of truth
PERMISSIONS = [
    ("sale.create",          "Sales",   "Create bills"),
    ("sale.void",            "Sales",   "Cancel a bill",              sensitive=True),
    ("sale.return",          "Sales",   "Process returns"),
    ("sale.discount",        "Sales",   "Apply discount"),
    ("pricing.view_cost",    "Pricing", "See cost price",             sensitive=True),
    ("pricing.edit",         "Pricing", "Change selling prices"),
    ("pricing.override_min", "Pricing", "Sell below minimum price",   sensitive=True),
    ("pricing.set_bounds",   "Pricing", "Set min/max selling price",  sensitive=True),
    ("stock.adjust",         "Stock",   "Adjust stock",               sensitive=True),
    ("report.profit",        "Reports", "View profit reports",        sensitive=True),
    ("user.manage",          "Admin",   "Manage users and roles",     sensitive=True),
    ...
]
```

Four enforcement points, deliberately redundant:

| Layer | Guards |
|---|---|
| Route (DRF `permission_classes`) | Can this user call this endpoint at all? |
| Serializer field | Is this field allowed in the response/request? (cost price) |
| Service | Business rules — price floor, credit limit, discount cap, branch scope. |
| Queryset/selector | Branch scoping and column selection. |

`PlanGate` sits above all four: a permission the plan doesn't include is never granted, even to the owner.

Permissions are cached per user in Redis (5 min TTL), invalidated on any `user_role` or `role_permission` write.

### 8.6 Logging & audit — two different things

| | Application logs | Audit log |
|---|---|---|
| Purpose | Debugging | Accountability |
| Store | stdout → Loki / files, 30 days | Postgres `audit_log`, retained per plan (min 7 years for financial rows) |
| Format | Structured JSON: `ts, level, request_id, tenant, user, msg, extra` | `who, what, entity, before, after, ip, impersonated_by, when` |
| Contains | Never PII, never cost, never tokens | Full before/after diffs |

Audit is written by an explicit `audit(...)` call inside services, not by a signal. Signals fire on
migrations, fixtures, and shell commands and produce garbage audit trails.

Always audited: price changes, min/max changes, stock adjustments, bill cancellation, discount
overrides, user/role changes, settings changes, login/logout/failed login, impersonation start/end,
data exports.

`audit_log` is append-only: `REVOKE UPDATE, DELETE` from the app role.

### 8.7 Testing strategy

| Layer | Tool | Target |
|---|---|---|
| Unit | pytest | Price resolution matrix, min/max enforcement, BS conversion golden file, stock math, money rounding, gapless numbering under concurrency |
| Integration | pytest + DRF `APIClient` + factory_boy | Every endpoint, happy + auth-denied + validation |
| **Tenant isolation** | pytest, parametrized over every tenant-scoped model | Tenant A must get 404/empty for every one of B's rows. Runs in CI on every PR. This is the test that protects the business. |
| Concurrency | pytest + threads | Two simultaneous sales of the last item; two bills grabbing the same invoice number |
| E2E | Playwright | Login → scan → bill → print; return; stock entry matrix; report by BS range |
| Load | k6 | `POST /sales` at 50 rps sustained; `GET /items/lookup` at 200 rps |

Coverage floor 80%, but 100% on `pricing/`, `sales/services/`, `inventory/services/`, and
`core/calendar/`. Those four are where a bug costs the shop money.

Fixtures use `factory_boy` with a `TenantFactory` that every other factory hangs off, so no test
can accidentally create cross-tenant data.

### 8.8 Deployment

**Phase 1 — one VPS, and that is fine.**

```
Caddy (wildcard TLS, *.dokan.com.np via DNS-01)
  ├─ web       : Gunicorn/Uvicorn × 4          (Django)
  ├─ worker    : Celery × 2                    (reports, SMS, IRD sync, rollups)
  ├─ beat      : Celery beat
  ├─ postgres  : 16, WAL archiving on
  └─ redis     : cache, sessions, celery broker, rate limit
```

An 8 GB / 4 vCPU VPS in Singapore or Mumbai (≈60–90 ms RTT to Kathmandu) comfortably serves
~300 shops. Static/media on S3-compatible storage (Cloudflare R2) with a CDN.

| Concern | Approach |
|---|---|
| Backups | `pg_dump` nightly + continuous WAL to object storage. **Restore drill on the 1st of every month, in the calendar, non-negotiable.** An untested backup is not a backup. |
| Per-tenant export | `manage.py export_tenant <slug>` → zip of CSVs. Shops will ask. Have it ready before they do. |
| Migrations | Two-phase for destructive changes: deploy code tolerating both shapes → migrate → deploy code using the new shape. Never drop a column in the same release that stops writing it. |
| Zero-downtime | Rolling restart behind Caddy; migrations must be backward compatible for one release. |
| Monitoring | Sentry (errors), Uptime Kuma (per-subdomain health), Grafana + Postgres exporter (slow queries, connections, replication lag). |
| Alerting | Page on: 5xx rate > 1%, `POST /sales` p95 > 1 s, DB connections > 80%, disk > 80%, backup job failure. |
| Secrets | Environment via Docker secrets / SOPS. Never in the repo. Startup asserts every required secret is present and fails loudly if not. |
| Environments | `dev` (local compose) → `staging` (real subdomain, anonymised data) → `prod`. |

**Phase 3 —** managed Postgres with a read replica, app containers on a small K8s or ECS,
Redis cluster, per-region deployment only if there is a second country.

---

## 9. Git & Development Workflow

### 9.1 Branching — trunk-based

```
main          always deployable, protected, every commit green
  ├── feat/sales-return-flow
  ├── fix/bs-date-off-by-one
  ├── chore/upgrade-django-5.1
  └── release/v1.2.0        (only if a release needs stabilising)
```

Branches live **≤ 3 days**. Longer means the slice was too big. No long-lived `develop` — it
only creates merge debt for a team this size.

### 9.2 Commits — Conventional Commits

```
feat(sales): add split payment with esewa and cash
fix(pricing): respect category min price when variant override is null
refactor(inventory): extract stock movement writer into service
perf(reports): add partial index for outstanding dues
chore(deps): bump djangorestframework to 3.16
docs(rate-rules): document price resolution chain
test(tenants): assert cross-tenant read denial for every model

BREAKING CHANGE: /api/v1/prices now requires rate_type_id
```

Scope = the app name. Body answers **why**, never **what** (the diff is the what). Reference issues:
`Closes #142`.

### 9.3 PR flow

1. Branch from `main`, one feature or one fix.
2. Push early, open a **draft PR** — CI runs from minute one.
3. CI gate (all required): lint (ruff/eslint) · format check · type check (mypy/tsc) · tests · coverage ≥ 80% · **tenant isolation suite** · migration check (`makemigrations --check --dry-run`) · secret scan (gitleaks).
4. PR template forces: what, why, screenshots for UI, migration notes, rollback plan.
5. One approval required, two for anything touching `pricing/`, `sales/services/`, `core/permissions/`, or migrations.
6. **Squash merge** — `main` history is one commit per feature and stays readable.
7. Delete branch on merge.

### 9.4 Releases

- SemVer, tagged on `main`: `v1.4.0`.
- `CHANGELOG.md` generated from conventional commits, hand-edited for a "what shopkeepers get" section in plain language.
- Deploy to staging on tag, promote to prod after smoke tests.
- Every release note includes the migration list and a rollback statement.

### 9.5 Migration discipline (the rules that prevent 3 a.m. pages)

| Rule | Why |
|---|---|
| One logical migration per PR | Bisecting a bad migration is impossible otherwise. |
| Never edit a migration that has run in prod | Write a new one. |
| Additive first: add nullable column → backfill in a separate job → make non-null later | Locks on a big table during deploy = downtime. |
| No `RunPython` without a `reverse_code` | Rollback must be possible. |
| Data migrations run as Celery tasks for tables > 100k rows | Migration timeouts kill deploys. |
| Index creation uses `CONCURRENTLY` (`AddIndexConcurrently`, `atomic = False`) | A plain `CREATE INDEX` locks writes — billing stops. |
| Every migration PR states expected duration on the largest tenant | Forces the author to actually check. |

---

## 10. Documentation Files

Kept in `/docs`, except `README.md` and `CHANGELOG.md` at the repo root. Rule: **a doc that
isn't updated in the PR that invalidated it gets deleted, not fixed later.** Stale docs are
worse than none.

| File | Purpose | Contents |
|---|---|---|
| `README.md` | 5-minute orientation for a new developer | What it is, stack, prerequisites, `docker compose up` quickstart, seed data command, how to run tests, links to every other doc. Nothing else — the README is a hub, not an encyclopedia. |
| `ARCHITECTURE.md` | Why the system is shaped this way | Context diagram, layering (view/service/selector), request lifecycle, subdomain routing, module map, key architectural decisions with rejected alternatives, known limits and their trigger points. |
| `MULTI_TENANCY.md` | The rules nobody may break | Isolation model, RLS policies and how to add one to a new table, tenant resolution middleware, `SET LOCAL` contract, PgBouncer constraints, tenant provisioning/suspension/deletion flow, per-tenant export, the tenant-isolation test suite and how to extend it. |
| `DATABASE_SCHEMA.md` | Living data map | ERD, per-table field docs with units and nullability, index list with justification, the three invariants (§3.5), naming conventions, soft-delete policy, retention policy. |
| `API_SPEC.md` | Contract for frontend and integrators | Link to generated OpenAPI, auth flow, envelope format, **full error code table**, pagination, idempotency contract, rate limits, versioning and deprecation policy. |
| `RBAC.md` | Who can do what | Full permission catalog with descriptions, default role→permission matrix, the four enforcement layers, how to add a permission, how plan gating interacts with permissions. |
| `RATE_RULES.md` | The money logic | Cost/MRP/rate-type/min/max definitions, the resolution chain with worked examples, min/max enforcement matrix, discount authority table, cost-visibility rules including the error-message leak rule, rate type lifecycle. |
| `NEPALI_LOCALIZATION.md` | BS calendar and Nepali conventions | Storage rules, `business_date_bs`/`fiscal_year_bs` contract, business-day boundary, conversion library and version pin, golden fixture location, fiscal year definition, number formatting (lakh/crore), Devanagari numerals, glossary of Nepali UI terms so labels stay consistent. |
| `UI_UX_GUIDE.md` | Keeps the UI simple as the team grows | Design principles, tokens (colour/type/spacing), component inventory, screen patterns (list/form/report), keyboard shortcut map, empty/loading/error state rules, mobile rules, accessibility floor, Nepali/English label pairs. |
| `COMPLIANCE_IRD.md` | Legal requirements, isolated so they can be audited | IRD computerized-billing requirements, gapless numbering implementation, no-deletion policy and credit note flow, materialized view log, CBMS sync design and retry policy, required invoice fields, VAT register formats. |
| `TESTING.md` | How to test this specific system | Test pyramid, how to write a tenant-isolation test, factory conventions, the four 100%-coverage modules and why, concurrency test patterns, E2E setup, load test targets, flaky test policy. |
| `GIT_WORKFLOW.md` | Team conventions | Branch naming, conventional commit spec with real examples, PR template and review rules, two-approver paths, release/tagging, hotfix procedure, migration discipline. |
| `DEPLOYMENT.md` | Runbook | Environment matrix, env var reference, first-time provisioning, deploy procedure, migration procedure, **rollback procedure**, backup and verified restore steps, DNS/TLS/wildcard setup, monitoring dashboards and alert meanings. |
| `ONBOARDING_TENANT.md` | Repeatable customer setup | Checklist to onboard a new shop: subdomain, plan, owner account, categories, size charts, rate types, opening stock import, staff training script, go-live checklist. Directly reusable by a non-technical support person. |
| `DATA_IMPORT.md` | Getting shops off Excel | CSV/Excel templates for items, variants, opening stock, customers, suppliers; validation rules; error report format; rollback of a bad import. This is the #1 migration blocker for a new customer. |
| `ROADMAP.md` | Where this is going | Phase definitions with scope and exit criteria, current phase status, explicitly deferred items with the trigger that would revive them. |
| `DECISIONS/` | ADR folder | One `NNNN-short-title.md` per significant decision: context, options, decision, consequences. Start with: 0001 RLS over schema-per-tenant, 0002 denormalized BS dates, 0003 weighted-average costing, 0004 PWA over native. |
| `CHANGELOG.md` | Release history | Keep-a-Changelog format, generated from commits, plus a plain-language "what's new for shops" section per release. |
| `SECURITY.md` | Security posture and reporting | Threat model summary, vulnerability disclosure contact, secret handling, dependency policy, incident response steps, data breach notification plan. |
| `CONTRIBUTING.md` | Local setup + house rules | Environment setup, code style, how to add an app, how to add a permission, how to add an RLS-protected table, PR expectations. |

The priority set — **README, ARCHITECTURE, MULTI_TENANCY, DATABASE_SCHEMA, RATE_RULES,
NEPALI_LOCALIZATION, GIT_WORKFLOW, ROADMAP** — plus DEPLOYMENT and CHANGELOG now exist.
Add the rest as the corresponding code lands. Writing all 19 upfront guarantees
17 of them go stale before anyone reads them.

---

## 11. Roadmap

### Phase 1 — MVP (≈ 3–4 months, target: 5 pilot shops)

**Goal:** one shop can run its entire counter on this and never open Excel again.

| Area | Scope |
|---|---|
| Platform | Tenant CRUD, subdomain routing, RLS, plans (Basic/Pro), super admin portal, impersonation with audit |
| Auth/RBAC | Phone login, 5 system roles, permission catalog, cost-price gating |
| Catalog | Categories, brands, size charts, items, variants, barcode generation, size×colour matrix entry |
| Pricing | Rate types (max 3), item/category prices, min/max bounds, discount caps |
| Stock | Opening stock, stock levels, movement ledger, adjustments, low-stock alerts |
| Sales | Fast billing, barcode scan, hold bill, cash + digital + credit, 80mm print, idempotency |
| Returns | Sales return with credit note and stock restore |
| Customers | Basic profile, default rate type, udharo ledger |
| Reports | Daily, monthly, yearly sales; stock summary; low stock; profit; dues |
| BS | Full BS input/display/reporting, fiscal year, BS date picker, presets |
| Ops | Audit log, settings, per-tenant export, nightly backup |

**Exit criteria:** a real shop runs 30 consecutive days with zero manual reconciliation; a
cashier reaches ≤ 20 seconds per 3-item bill; a restore drill passes.

**Explicitly NOT in Phase 1:** multi-branch, offline mode, IRD sync, loyalty, purchase orders,
commissions, mobile app, custom domains. Every one of these is a real feature — none of them
is what stops a shop from adopting on day one.

### Phase 2 — Business expansion (≈ 4–5 months, target: 50 shops)

| Area | Scope |
|---|---|
| Purchasing | Suppliers, purchase invoices, GRN, landed cost, payables, purchase orders, reorder suggestions |
| Multi-branch | Branches, branch-scoped roles, stock transfers with in-transit, consolidated reports |
| Exchange | One-screen exchange (return + sale pair) |
| **IRD / VAT** | VAT invoicing, sales/purchase registers, materialized view log, CBMS real-time sync with retry queue |
| Payments | Fonepay/eSewa/Khalti QR integration, split tenders, cash session & day close |
| Customers | Loyalty points, festival/birthday SMS campaigns, customer segments |
| Staff | Salesperson attribution, commission rules, staff performance report |
| Stock | Physical count with variance, damage/write-off, ageing & dead stock report |
| Reports | Size/colour matrix, hourly heatmap, discount analysis, expense tracking, net profit |
| Ops | Data import wizard (Excel), barcode/price-tag label printing, self-serve tenant signup + online plan payment |

**Exit criteria:** a VAT-registered shop passes an IRD check; 50 tenants on one VPS with p95 < 400 ms.

### Phase 3 — Scale & automation (ongoing, target: 500+ shops)

| Area | Scope |
|---|---|
| **Offline-first POS** | Dexie queue, background sync, conflict policy, offline barcode lookup, offline invoice numbering (device-prefixed reservation blocks) |
| Performance | Nightly rollup tables, read replica, `fiscal_year_bs` partitioning, query budget in CI |
| Automation | Auto reorder suggestions from velocity, auto festival campaigns, scheduled report emails, WhatsApp/Viber receipts, low-stock push |
| Intelligence | Size-curve recommendations (which sizes to buy per style), seasonal demand forecast, slow-mover discount suggestions, basket analysis |
| Platform | Custom domains, white-label branding, public API + webhooks, franchise/multi-tenant groups, usage-based billing |
| Ecosystem | Native mobile app for owners, accountant read-only portal, e-commerce/Instagram catalog sync, courier integration, accounting software export |
| Reliability | Managed Postgres + replica, container orchestration, chaos/restore drills automated, SLA + status page |

---

## 12. What I would deliberately not build

Named here so nobody rebuilds them by accident:

| Not building | Instead | Revive when |
|---|---|---|
| Microservices | One Django app, clean module boundaries | Never, for this scale. A modular monolith with RLS scales past 1,000 shops. |
| Generic EAV attributes | `size` + `color` columns + `attributes jsonb` | A tenant needs to *query* by a custom attribute, not just display it. |
| FIFO/LIFO costing | Moving weighted average | An accountant contractually requires FIFO. The batch table already exists to support it. |
| Full double-entry accounting | Party ledger + expense tracking | Shops ask for balance sheets. Until then, export to their accountant's software. |
| Event sourcing | `stock_movement` ledger (already event-shaped for the one thing that needs it) | Never for the rest of the domain. |
| Custom auth | Django auth + SimpleJWT | Never. |
| Schema-per-tenant | RLS | A single tenant needs a physically separate database contractually. |
| GraphQL | REST + typed generated client | A third-party integrator demands it. |
| Kubernetes | Docker Compose on one VPS | One VPS stops being enough — that is a good problem, solve it then. |
| A design system from scratch | Tailwind + a small `components/ui` set | Never. |

---

## Appendix A — Nepal-specific requirements checklist

- [ ] IRD computerized billing system approval before onboarding VAT-registered shops
- [ ] Gapless, per-fiscal-year, per-branch invoice numbering
- [ ] No bill deletion — credit notes only
- [ ] Materialized view log of all bill activity, retained and exportable
- [ ] CBMS real-time sync with durable retry queue and a visible sync status per bill
- [ ] PAN/VAT number on tenant and on every tax invoice
- [ ] "Tax Invoice" / "Abbreviated Tax Invoice" wording per bill type
- [ ] 13% VAT handling with taxable/non-taxable item flags
- [ ] Nepali fiscal year Shrawan 1 → Ashad end everywhere a year is grouped
- [ ] Nepali number formatting (lakh/crore grouping)
- [ ] Devanagari numeral option
- [ ] Nepali-language UI labels for all counter-facing screens
- [ ] Fonepay / eSewa / Khalti / ConnectIPS payment support
- [ ] Offline tolerance for load shedding and ISP drops
- [ ] SMS via a Nepali provider (Sparrow SMS / Aakash SMS) with delivery reports
- [ ] Data export a shop can take with them — trust, and a legal expectation

> Verify current IRD/CBMS technical requirements with a Nepali chartered accountant or
> directly with the IRD before building the compliance module. Rules change and the
> penalty for guessing wrong lands on the shop, not on us.

---

## Appendix B — First 10 commits

```
chore(repo): scaffold django project, docker compose, ruff, pytest, CI
feat(core): tenant-scoped base models, RLS helpers, tenant middleware
feat(tenants): tenant, plan, subscription models and provisioning service
feat(accounts): user, role, permission catalog, phone auth
test(tenants): cross-tenant isolation suite over every scoped model
feat(core): BS calendar module with golden-file conversion tests
feat(catalog): category, size chart, item, variant with barcode generation
feat(pricing): rate types, item_price, price resolution engine
feat(inventory): stock level, immutable movement ledger, opening stock
feat(sales): billing service with gapless numbering and idempotency
```

The isolation suite and the BS golden-file tests land **before** the first business feature.
Both are cheap to write on day one and effectively impossible to retrofit once thirty models
exist.
