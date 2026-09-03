# Changelog

All notable changes to Dokan, grouped by release. Generated from conventional
commits; each release ends with a plain-language section for shop owners.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-09-03

### Ecommerce completion

- `storefront` — customers can now choose a size/colour option, keep a
  persistent bag, verify their email with a six-digit code, place an
  idempotent COD pickup or delivery order, review order history, and follow a
  public tracking page. Checkout re-prices every line server-side and requires
  the verified email identity to match the order
- `storefront` — active orders reserve stock at the tenant's default branch so
  concurrent checkouts cannot oversell. Placement never mutates stock; tenant
  staff accept an order into exactly one linked HELD POS bill, where the
  existing sale completion path posts the immutable stock ledger movement
- `frontend` — tenant staff receive an ecommerce-gated Online orders inbox
  with status filters, prepare/open-held-bill actions, safe cancellation, and
  the CONFIRMED → PACKED → SHIPPED → DELIVERED lifecycle. Completed invoices
  remain immutable and require the normal return flow
- `security` — online payment is explicitly rejected until a verified gateway
  is integrated; cross-customer idempotency collisions, duplicate variants,
  unverified checkout, POS-only products, and fully reserved stock are blocked
- `test` — the fresh-Compose Playwright suite now covers the complete public
  store → email OTP → COD checkout → staff inbox → held POS bill journey; the
  demo seed exposes `demo-store.shop.localhost` for local testing

## [1.1.0] - 2026-09-02

### Observability and operations

- `infra` — Compose now uses explicit environment allowlists instead of passing
  `.env` wholesale. Database-owner, migrator, backup, monitoring, and edge TLS
  credentials stay within their trust boundaries; migrations and demo seeding
  run in short-lived direct-database containers, and CI rejects regressions
- `infra` — Django and Celery now reach PostgreSQL through a digest-pinned
  PgBouncer 1.25.2 service fixed to transaction pooling. Production refuses
  any other declared pool mode, server-side cursors are disabled, only the
  constrained app role is admitted, and CI proves tenant session context is
  cleared after commit against real PostgreSQL
- `core` — every response now carries a validated UUID4 request id; production
  emits allowlist-only JSON request/health logs and bounded Prometheus metrics.
  Separate liveness and dependency-readiness endpoints support safe orchestration,
  while the metrics endpoint is disabled by default and denied at the public edge
- `core` — optional Sentry reporting strips user identity, request bodies,
  cookies, URLs and query strings, arbitrary messages, exception text,
  non-allowlisted headers, secrets, cost and price data before transmission.
  Production also rejects email backends that would print OTPs into logs
- `ops` — the monitoring profile now provisions Prometheus alert rules,
  Grafana dashboards, PostgreSQL/Redis/Celery/node/container exporters, Uptime
  Kuma, and 30-day Loki log retention through allowlisted Docker discovery in
  Grafana Alloy. Recovery scripts publish verified backup, WAL-upload and
  restore-drill timestamps; a non-RLS-bypassing `pg_monitor` role supplies only
  server statistics

### Account security

- `accounts` — tenant access and rotating refresh tokens now carry a registered
  device session id. Logout, password reset, password change, and self-service
  device revocation invalidate affected tokens immediately under tenant RLS;
  successful/failed login, logout, password, OTP, and revocation actions are
  explicit audit events
- `accounts` / `notifications` — enumeration-safe password reset and optional
  login verification use six-digit SMS codes stored only as HMAC hashes, with a
  ten-minute expiry, five-attempt lock, and resend cooldown. Security delivery
  bypasses subscription SMS quotas
- `frontend` — every tenant user gets a bilingual Account security screen for
  password changes, SMS login-code setup, and registered-device review, plus
  OTP-aware login and a complete forgot-password flow

### API contract

- `api` — all tenant, platform-admin, and storefront operations now publish a
  warning-free OpenAPI 3.1 contract with stable operation IDs, both JWT realms,
  standard success/error envelopes, required idempotency headers, and a
  canonical machine-readable error-code enum. The reviewable schema and
  generated TypeScript declarations are committed; backend and frontend CI
  regenerate them and fail on drift. Framework and resource-not-found errors
  are normalized to stable `UPPER_SNAKE_CASE` codes

### Operations and integrity

- `inventory` — a monthly Celery reconciliation now rebuilds each active
  tenant's `stock_level` quantity and branch moving-average cost from the
  immutable movement ledger, recreates missing projection rows, repairs drift
  under tenant RLS, keeps sent stock explicitly in transit, and emits a
  structured error-level alert whenever a repair is required

### Reports and localization

- `reports` — implemented report pages now export real `.xlsx` workbooks and
  print in A4 or 80mm layouts. The export service re-checks plan features and
  route permissions, uses selectors only, neutralizes spreadsheet formulas,
  and never includes cost columns without `pricing.view_cost`
- `frontend` — report date ranges now use the canonical BS conversion library
  through a keyboard-accessible Nepali calendar picker, while API filters stay
  anchored to AD ISO dates

### Design system

- `frontend` — UI/UX refinement pass across the tenant panel and the
  platform-admin portal: Inter Variable typography (self-hosted, so the
  offline POS never needs a CDN; Devanagari keeps its Noto fallback),
  antialiasing + brand-tinted text selection + slim scrollbars, buttons
  with a proper `loading` spinner state and native-style press feedback,
  cards on the layered `--shadow-card` token, refined table headers and
  cell rhythm, a shared tenant `PageHeader` replacing seven hand-rolled
  screen headers, sidebar/nav polish in both shells (active-route rail,
  avatar user blocks, blurred mobile chrome, hover-lift FAB), and
  international-style sign-in screens (tracked one-time-code entry on
  the admin portal)

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
- `storefront` — shops now control their own store: `StoreSettings`
  (hero title/subtitle, announcement strip, one store-wide offer with a
  ≤90% discount that applies to website prices only, and the website
  price currency) edited from the tenant panel's new Online store screen
  (`GET/PATCH /storefront/settings`, `settings.manage`, audited). Catalog
  items gain a `website_price` — the single online price the storefront
  shows instead of the counter range (struck-through original while an
  offer runs); when the store and shop currencies differ the range
  converts at the NPR/INR peg for display. Both templates render the
  dynamic hero, announcement, offer badge, and sale prices
- `storefront` — ordering backend: shoppers buy with **email-OTP login,
  no passwords** (`StoreCustomer` auto-created on first login or first
  order; 6-digit codes, hashed, 10-min TTL, 5 attempts, 60s cooldown;
  signed 30-day customer tokens). `GET /storefront/products/<id>` exposes
  the variant matrix (size/colour, per-variant stock boolean, offer
  price) for the size picker. Checkout (`POST /storefront/orders`,
  mandatory Idempotency-Key with 200-replay) validates stock, prices
  every line server-side (discounted website price, peg-converted
  fallback), supports **delivery (address + lat/lng snapshot) or store
  pickup, COD or online-payment (manual confirm until a gateway lands)**,
  and numbers orders gaplessly (`ORD-000001`). Orders never touch stock
  at placement — POS confirmation posts the SALE later (invariant 1).
  Public tracking at `GET /storefront/orders/<token>`, order history at
  `GET /storefront/my/orders`. Order confirmation + OTP emails via
  Django's email backend (console locally, SMTP env vars in production)
- `platformadmin` — the Online store card is now a guided 4-step setup
  (enable service → assign address → pick template → live link with
  hand-off note), with an inline one-click "Enable e-commerce" override
  for SUPER_ADMINs
- `frontend` — the tenant's Online store screen gains a setup checklist
  (address assigned, service active, content added, website prices set
  with live counts) so shops see exactly what is left to do
- `storefront` — merchandising suite: per-product online offers
  (`Item.website_discount_pct` beats the store-wide offer), product
  visibility and featured flags on the website (`website_visible` hides a
  POS item online and blocks checkout for it; featured products sort
  first and fill a storefront rail via `GET /storefront/products?featured=1`),
  a schedulable store-wide offer (`offer_ends_at` — a lapsed offer stops
  discounting and disappears automatically), an offer popup shown once per
  visitor session (`popup_*`, CTA links vetted against `javascript:` URLs),
  and up to five promo banner cards (`banners` JSON, shape-validated in the
  service). Checkout prices lines with the same canonical rule the grid
  shows (`selectors.website_pricing`), and the public payloads gain
  `offer_pct` badges. The tenant panel edits it all from the item form
  (website offer %, show/featured switches) and the Online store screen
  (offer last day, popup form, banner editor); both templates render
  banners, the featured rail, discount badges, and an "Ends in N days"
  urgency line
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
