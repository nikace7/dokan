# Changelog

All notable changes to Dokan, grouped by release. Generated from conventional
commits; each release ends with a plain-language section for shop owners.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Storefront (new)

- `storefront` — the public online store is born: anonymous, read-only
  catalog browsing on the separate `*.shop.<root>` namespace
  (`<address>.shop.mero-pasal.online`), resolved from the tenant's
  `shopfront_subdomain`, plan-gated on the `ecommerce` feature (402 when
  off). `GET /storefront/site` (shop identity, template, contact, category
  nav) and `GET /storefront/products` (paged grid: name, photo, brand,
  selling-price range, in/out-of-stock boolean — never cost, never exact
  quantities), anonymous-throttled at 120/min
- `storefront/` — a new Vite + React SPA for the shop website with a
  template registry and the first two design templates: **Aurora**
  (premium minimal boutique: serif hero, editorial grid, reveal-on-scroll)
  and **Bazaar** (refined grand-bazaar elegance: emerald/brass palette,
  arch-framed hero portrait, brass marquee, serif display type). Category filters, search, quick-view with call-to-order,
  mobile-first, reduced-motion aware
- `tenants` — `shopfront_template` chooses the design (SUPER_ADMIN via
  tenant PATCH); the admin panel's Online store card now shows the live
  `*.shop.<root>` URL and a template picker
- `edge` — Caddy serves `*.shop.<root>` with its own wildcard certificate
  (Cloudflare DNS-01 in production, internal CA locally); the existing
  wildcard DNS record already covers the extra label

### Platform

- `platformadmin` — tenants can now carry a `shopfront_subdomain` (SUPER_ADMIN
  PATCH on `/admin/tenants/<id>`): the reserved public address of the shop's
  future online store, validated for format/reserved names and collision-checked
  against every tenant slug and shopfront (shared wildcard host). Changes are
  audited with before/after snapshots
- `admin frontend` — tenant detail gains an "Online store" panel: assign,
  change, or disable the storefront address with a live URL preview

### Accounts

- `frontend` — the sidebar, mobile tabs, new-sale FAB, and the reports home
  grid are now permission-aware: staff only see the screens their role's
  permission codenames actually allow (enforcement stays server-side)

### Catalog

- `catalog` — one-transaction `POST /catalog/products/quick-create`:
  item + size×colour variant matrix + optional opening stock in a single
  call (stock block additionally requires `stock.adjust`; cost fields stay
  hidden without `pricing.view_cost`)
- `frontend` — the `/catalog/items/new` screen is now a single mobile-first
  page: product basics, optional details, size/colour chips, and per-combo
  opening quantities with a shared cost; edit flow unchanged

### What shopkeepers get

- **Your shop, online.** Ask us for the online store and we switch on your
  own shop website — your products, photos, prices, and live stock, in a
  design you pick. Customers browse and call to order; you keep selling at
  the counter exactly as today.
- **Staff see only what they can use.** A cashier sees Billing and Stock;
  collection and profit figures stay with admin-level roles — no more
  dead-end menu entries hinting at numbers meant for the owner.
- **Add a product once, sell it a minute later.** Name, photo, price range,
  sizes, colours, and how many pieces are on the shelf — all on one screen,
  one save. No more hopping between three pages before the first bill.

## [1.0.0] - 2026-08-05

First release. The full Phase 1 platform plus a running start on Phase 2,
landed across 37 pull requests.

### Platform

- `core` — backend spine: BS calendar, Decimal money helpers, Postgres RLS,
  tenant middleware, gapless numbering, permission catalog, response envelope
- `tenants` — plans, tenants, subscriptions, feature overrides, nightly usage
  snapshots; cached slug-based tenant resolution; portable per-tenant export
- `tenants` — plan enforcement: feature-gated routes return 402, usage limits
  hard-block writes under tenant-row locks
- `accounts` — tenant users with phone + password JWT auth (ADR 0001),
  failed-login lockout, tenant-claim binding, custom roles, branch-aware
  staff assignments
- `frontend` / `web` — tenant SPA: auth flow, billing, catalog, stock,
  purchasing, ledgers, reports, dashboard, pricing, customers, settings

### Billing & Sales

- `sales` — one-transaction POS billing with price resolution, 13% VAT rule,
  udharo with credit-limit enforcement, ledger postings, and mandatory
  `Idempotency-Key` with 200-replay
- `sales` — gapless per-branch-per-fiscal-year invoice numbering
- `sales` — held bills (no stock, no invoice number until billed)
- `sales` — returns with credit notes on their own gapless RETURN series,
  proportional discount/VAT, refunds against outstanding
- `sales` — one-screen exchange: one transaction, one group, net settlement
- `sales` — audited 80mm bilingual receipt printing with F9 auto-print

### Inventory

- `inventory` — immutable `stock_movement` ledger + same-transaction
  `stock_level` projection; moving weighted average cost
- `inventory` — opening stock, signed adjustments, damage write-offs
- `inventory` — branch-to-branch transfers with a documented in-transit model
- `inventory` — physical counts with variance snapshot and finalize
- `catalog` — categories, brands, size charts, items, variants, size×colour
  matrix entry, barcode/SKU lookup (ADR 0003)

### Pricing

- `pricing` — rate types with one default per tenant and permission gating
- `pricing` — effective-dated prices at variant/item/category scope with the
  VARIANT → ITEM → CATEGORY → MRP resolution chain (ADR 0005)
- `pricing` — min/max guardrails, `pricing.override_min` with required reason,
  append-only price change log

### Payments

- `payments` — append-only payments and allocations; outstanding derived from
  the ledger, never by editing completed invoices
- `payments` — negative counter-entry reversals with audit
- `payments` — cash sessions with tender-aware expected cash, supplier cash
  outflows, variance snapshot; POS completion requires an open session
- `purchasing` — suppliers and DRAFT→CONFIRMED purchase invoices posting
  stock at landed unit cost (exact-paisa charge allocation)

### Reports

- `reports` — daily/monthly/item sales, stock summary/low/dead, profit
  (gated on `report.profit` + `pricing.view_cost`), dues aging, VAT registers
- `reports` — role-filtered dashboard: today's sales/profit/dues/low stock,
  30-day trend, recent bills
- `expenses` — expense categories and CRUD with AD/BS filters; net profit

### Admin & Security

- `platformadmin` — separate admin-host auth realm (password + TOTP, IP
  allowlist), plan CRUD, atomic tenant provisioning and lifecycle,
  append-only platform audit log
- `platformadmin` — time-boxed READ_ONLY/READ_WRITE support impersonation
  with reason bounds, durable + Redis revocation, owner SMS, tenant-side red
  banner and end-now control, owner-visible access log
- `audit` — append-only audit log (REVOKE UPDATE/DELETE) with request context,
  wired to high-value mutations
- `notifications` — SMS receipts behind a vendor-neutral provider contract
  (ADR 0004), Celery delivery with bounded retry

### Ops

- `ops` / `infra` — Docker Compose stack, wildcard-TLS Caddy, CI pipeline
  (lint, format, types, tests with coverage floor, gitleaks, migrations check)
- `ops` — verified nightly logical dumps, weekly physical base backups,
  continuous S3-compatible WAL upload; guarded restore drill exercised in CI
- `ops` — production frontend as an unprivileged immutable image behind
  Caddy, smoke-tested as an edge stack in CI
- `ci` — frontend unit suite and tenant-isolation suite run against real
  Postgres on every PR

### What shopkeepers get

- **Billing that never loses a number.** Bill numbers run in order per shop
  per Nepali fiscal year, and a completed bill can never be edited or
  deleted — corrections happen through credit notes, exactly as IRD expects.
- **No double billing from a shaky connection.** If the network stutters and
  the bill is sent twice, the second send returns the original bill instead
  of creating a duplicate.
- **Udharo without the khata copy.** Customer credit is tracked per bill and
  per payment; what a customer owes is always the bills minus what they have
  paid — nobody edits the old bill to make the math work.
- **Stock that can't be edited behind your back.** Every piece in or out is a
  permanent ledger entry with who did it and when. Opening stock, damages,
  branch transfers, and physical counts all leave a trail.
- **Prices with guardrails.** Retail/wholesale/member rates, minimum and
  maximum selling prices, and a record of every price change. Selling below
  the minimum needs a manager's permission and a written reason.
- **Reports in BS dates.** Daily, monthly, and fiscal-year reports in Bikram
  Sambat, VAT sales and purchase registers, dues aging, profit (owner only),
  and a dashboard that opens on today's numbers.
- **The cash drawer adds up.** Day-close compares expected cash per payment
  method against what is counted and shows the difference.
- **SMS receipts** to customers, in Nepali-friendly format, sent
  automatically after billing.
- **Your data stays yours.** A full export of your shop's data is available
  on request, and nightly backups are verified by actually restoring them.
