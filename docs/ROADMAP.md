# Roadmap

Where the product is going and where it stands. Phase definitions and exit
criteria live in `docs/SYSTEM_DESIGN.md` §11 — this doc tracks **status
against the shipped code**, it does not re-specify the phases. Status as of
1.0.0 (2026-08-05), reflecting 37 merged PRs.

Legend: ✅ shipped · 🔨 in progress · ⬜ not started

---

## Phase 1 — MVP: ✅ complete

One shop can run its entire counter on Dokan. Shipped:

| Area | What landed |
|---|---|
| Platform spine | Django 5 + DRF, Postgres RLS with `FORCE ROW LEVEL SECURITY`, subdomain tenant resolution, BS calendar + money core, gapless numbering, permission catalog, response envelope |
| Tenancy & plans | Plans, tenants, subscriptions, feature overrides, usage snapshots; plan enforcement above route permissions (feature-gated routes return 402; staff/item/rate-type/SMS write limits hard-block) |
| Auth & RBAC | Phone + password JWT login per ADR 0001, optional SMS OTP, enumeration-safe SMS reset, revocable registered-device sessions, failed-login lockout, tenant-claim binding, custom roles, branch-aware staff assignments |
| Platform admin | Separate `admin.` host auth realm with IP allowlist + TOTP, plan CRUD, atomic tenant provisioning/lifecycle, append-only platform audit, time-boxed support impersonation with durable + Redis revocation and tenant-side red banner/end-now |
| Catalog | Category tree, brands, size charts, items, variants, size×colour matrix entry, barcode/SKU POS lookup (ADR 0003) |
| Inventory | Immutable `stock_movement` ledger + `stock_level` projection, opening stock, signed adjustments, damage write-offs, moving weighted average |
| Pricing | Rate types, effective-dated scoped prices, min/max guardrails, price change log (ADR 0005) — see `docs/RATE_RULES.md` |
| Sales | One-transaction POS billing, held bills, gapless numbering, `Idempotency-Key` with 200-replay, open-cash-session guard, F9 quick-complete, on-demand 80mm bilingual receipts |
| Customers | CRUD with partial-unique phone, credit limit gated on `customer.credit` |
| Payments | Append-only payments + allocations, canonical ledger-derived outstanding, reversals, cash sessions with tender-aware day close |
| Reports | Daily/monthly/item sales, stock summary/low/dead, profit (gated), dues, VAT registers, role-filtered dashboard |
| Audit | Append-only `audit_log` with request context, wired to high-value mutations |
| Notifications | SMS receipts behind a vendor-neutral provider (ADR 0004), Celery delivery with bounded retry |
| Ops | Tenant export (no-overwrite ZIP), verified nightly dumps + weekly base backups + continuous WAL with CI-exercised restore drill, production frontend behind Caddy with edge-stack smoke test |

Phase 1 scope items intentionally superseded or absorbed into Phase 2 (e.g.
multi-branch structures landed early because the schema needed them from the
start) are counted in the Phase 2 table below.

## Phase 2 — Business expansion: 🔨 in progress

| Item | Status |
|---|---|
| Suppliers, purchase invoices, landed cost (largest-remainder paisa allocation) | ✅ |
| Stock transfers (documented in-transit model) | ✅ |
| Physical counts with variance and finalize | ✅ |
| Exchange (one transaction, return + sale pair, net settlement) | ✅ |
| VAT rule (13%) on sales and purchases; sales + purchase VAT registers | ✅ |
| Expenses + net profit report | ✅ |
| Branches + branch-aware roles + consolidated reporting | 🔨 (branches, assignments, and branch-scoped numbering exist) |
| **IRD/CBMS real-time sync with retry queue** | 🔨 landing concurrently (`apps/compliance` is still an empty skeleton on `main`) |
| Materialized-view (electronic log) of all bill activity | ⬜ |
| Fonepay / eSewa / Khalti QR tender integration | ⬜ (payment recording exists; gateway integrations do not) |
| Loyalty points, festival/birthday SMS campaigns, segments | ⬜ |
| Salesperson attribution, commissions, staff performance | ⬜ |
| Purchase orders, GRN, reorder suggestions | ⬜ |
| Size/colour matrix, hourly heatmap, discount analysis reports | ⬜ |
| Data import wizard (Excel), barcode/price-tag label printing | ⬜ |
| Self-serve tenant signup + online plan payment | ⬜ |

## Phase 3 — Scale & automation: 🔨 started

| Item | Status |
|---|---|
| **Offline-first POS** (Dexie queue, idempotent drain against `POST /sales`, server-side invoice numbering, server-wins conflicts — [ADR 0006](DECISIONS/0006-offline-sync-policy.md)) | 🔨 in progress |
| Nightly rollup tables, read replica, `fiscal_year_bs` partitioning | ⬜ (trigger-based, not calendar-based) |
| Automation, intelligence, platform/ecosystem items | ⬜ (see SYSTEM_DESIGN §11 Phase 3 for the full list) |

## Deferred deliberately

The "not built" list (microservices, EAV, FIFO/LIFO, double-entry accounting,
custom auth, schema-per-tenant, GraphQL, Kubernetes, custom design system)
with its revive conditions is in SYSTEM_DESIGN §12 — do not reintroduce any
of it without satisfying the listed trigger.
