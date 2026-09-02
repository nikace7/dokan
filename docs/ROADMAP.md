# Roadmap

Where the product is going and where it stands. Phase definitions and exit
criteria live in `docs/SYSTEM_DESIGN.md` §11 — this doc tracks **status
against the shipped code**, it does not re-specify the phases. Status as of
2026-09-02 on the current release branch.

Legend: ✅ shipped · 🔨 in progress · ⬜ not started · ⚠ external gate

---

## Release-candidate readiness

The repository implementation is feature-complete for the Phase 1 pilot and
the delivered extensions below. That is different from authorization to serve
real shops:

| Gate | Status |
|---|---|
| Local quality baseline | ✅ 967 backend tests pass with 92.05% branch-aware coverage and enforced 100% line/branch coverage on money-critical modules; tenant/admin frontend, storefront, and 12-scenario Compose Playwright suites pass; lint, type, generated-contract, source-size, bundle, dependency, secret, pooling, and recovery checks are wired |
| Hosted CI on the candidate stack | ✅ Integration PR #125 passed backend, frontend/edge, storefront, recovery, gitleaks, and the 12-scenario fresh-Compose E2E suite |
| Protected `main`, review policy, merge, and SemVer release | ✅ `main` requires all seven CI checks, strict freshness, resolved conversations, and no admin bypass; the solo-maintainer self-review policy is active, integration PR #125 is merged, and this changelog records the `v1.1.0` release candidate |
| Production DNS/wildcard TLS, strong secrets, SMTP, SMS, live CBMS decision, and S3-compatible backup target | ⚠ operator/provider setup |
| Staging restore rehearsal, alert delivery test, external uptime/TLS checks, and pilot acceptance | ⚠ operator validation |

The exact production checklist is in [DEPLOYMENT.md](DEPLOYMENT.md). Payment
gateways and the later business features remain product roadmap work; they are
not hidden launch-readiness defects in the shipped COD/cash workflow.

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
| Reports | Daily/monthly/item sales, stock summary/low/dead, profit (gated), dues, VAT registers, role-filtered dashboard; canonical BS picker, permission-safe Excel export, A4/80mm print |
| Audit | Append-only `audit_log` with request context, wired to high-value mutations |
| Notifications | SMS receipts behind a vendor-neutral provider (ADR 0004), Celery delivery with bounded retry |
| Ops | Tenant export; PgBouncer transaction pooling; per-service secret boundaries; verified dumps/base backups/continuous WAL; monitoring stack; production edge and fresh-Compose E2E gates |

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
| **IRD/CBMS real-time sync with retry queue** | 🔨 durable frozen-payload queue, bounded retry, status/failure APIs complete; live IRD adapter and operator certification remain |
| Materialized-view (electronic log) of all bill activity | ⬜ |
| Fonepay / eSewa / Khalti QR tender integration | ⬜ (payment recording exists; gateway integrations do not) |
| Loyalty points, festival/birthday SMS campaigns, segments | ⬜ |
| Salesperson attribution, commissions, staff performance | ⬜ |
| Purchase orders, GRN, reorder suggestions | ⬜ |
| Size/colour matrix entry | ✅ |
| Hourly heatmap and discount analysis reports | ⬜ |
| Data import wizard (Excel), barcode/price-tag label printing | ⬜ |
| Self-serve tenant signup + online plan payment | ⬜ |

## Delivered product extensions

| Item | Status |
|---|---|
| Public per-shop storefront on `*.shop.<root>`, plan gating, safe catalog/pricing, promotions, featured products, and `aurora`/`bazaar` templates | ✅ |
| Email-OTP store customers, idempotent COD/pickup/delivery orders, history and token tracking | ✅ |
| Online order payment collection and POS order-confirmation workflow | 🔨 order records support the states; gateway and final counter workflow remain |
| Account recovery, optional login OTP, and immediate registered-device revocation | ✅ |
| Permission-safe Excel report exports and A4/80mm report printing | ✅ |

## Phase 3 — Scale & automation: 🔨 started

| Item | Status |
|---|---|
| **Offline-first POS** (Dexie queue, idempotent drain against `POST /sales`, server-side invoice numbering, server-wins conflicts — [ADR 0006](DECISIONS/0006-offline-sync-policy.md)) | ✅ |
| Nightly rollup tables, read replica, `fiscal_year_bs` partitioning | ⬜ (trigger-based, not calendar-based) |
| Automation, intelligence, platform/ecosystem items | ⬜ (see SYSTEM_DESIGN §11 Phase 3 for the full list) |

## Deferred deliberately

The "not built" list (microservices, EAV, FIFO/LIFO, double-entry accounting,
custom auth, schema-per-tenant, GraphQL, Kubernetes, custom design system)
with its revive conditions is in SYSTEM_DESIGN §12 — do not reintroduce any
of it without satisfying the listed trigger.
