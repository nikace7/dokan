# AGENTS.md — Clothing Shop Management System

This file orients an AI coding agent that knows nothing about the project. Read it fully
before making changes.

## Repository status

The authoritative specification is `docs/SYSTEM_DESIGN.md` (Design v1, 2026-07-27).
The **backend platform spine is scaffolded** under `backend/` (Django 5 project:
`config/` settings split, `core/` spine — BS calendar, money, RLS helpers, tenant
middleware, numbering, permissions — and empty `apps/` skeletons per §8.2), with
root infra (`Dockerfile`, `docker-compose.yml`, `Caddyfile`) and
`.github/workflows/ci.yml`. The **frontend is scaffolded** under `frontend/` (Vite +
React + TS: app router/providers, `lib/bs`, `lib/money`, `lib/api`, `components/ui`,
feature placeholders). Foundation docs exist: `docs/ARCHITECTURE.md`,
`docs/MULTI_TENANCY.md`, `docs/DATABASE_SCHEMA.md`, `docs/DECISIONS/0001-0004`.

**Landed business features:** `apps/tenants` (Plan, Tenant, TenantSubscription,
TenantFeatureOverride, TenantUsageSnapshot — platform scope; Branch — RLS-protected;
cached slug selector behind the tenant middleware), `apps/accounts` (tenant-scoped
User with phone auth, Role, global Permission catalog, RolePermission, UserRole;
JWT login/refresh/me per ADR 0001 with failed-login lockout and tenant-claim
binding), `apps/platformadmin` (PlatformUser model only, no portal yet),
`apps/catalog` (Category tree, Brand, SizeChart, Item, ItemVariant with
size×colour matrix bulk entry and the barcode/SKU POS lookup; barcode
validation per ADR 0003; `avg_cost` hidden without `pricing.view_cost` at
both serializer and selector layers), `apps/inventory` — COMPLETE (StockLevel
projection + immutable StockMovement ledger with REVOKE UPDATE/DELETE from the
app role; opening/adjustment/damage write paths with per-(branch,variant) row
locking and moving weighted average; PURCHASE postings at landed cost; SALE /
SALE_RETURN via sales; stock TRANSFERS with documented in-transit model
(TRANSFER_OUT at source basis, TRANSFER_IN at exactly that basis, zero-delta
shortage annotation) and PHYSICAL COUNTS (system_qty snapshot, variance,
COUNT movements on finalize); BS/fiscal-year denormalization at write time;
cost columns hidden without `pricing.view_cost`), `apps/pricing` (RateType with
one-default-per-tenant and required_permission gating; effective-dated ItemPrice
at VARIANT/ITEM/CATEGORY scope with exactly-one-FK CHECK; resolve_price chain
VARIANT → ITEM → CATEGORY-tree → MRP → 409 PRICE_NOT_SET; min/max guardrails
(variant → item → category pct-of-MRP) with pricing.override_min and always-block
above-max; PriceChangeLog written in the same transaction as every price change),
`apps/customers` (Customer CRUD, partial-unique phone, nullable credit_limit),
`apps/sales` (POS billing core: one-transaction create_sale with price
resolution, documented 13% VAT rule, udharo + credit-limit enforcement, SALE
ledger postings, gapless per-branch-per-fiscal-year numbering, cost_at_sale
snapshots, mandatory Idempotency-Key with 200-replay; held-bill flow where HELD
takes no stock and no invoice number; COMPLETED terminal), returns & exchange
(`apps/sales/services/returns.py` — credit notes with their own gapless RETURN
numbering series, proportional discount/VAT math, SALE_RETURN at original
cost_at_sale, refunds JSON settlement incl. CREDIT_NOTE against udharo with
computed outstanding; `apps/sales/services/exchange.py` — one transaction, one
exchange_group_id, RETURN + SALE docs with net settlement), `apps/purchasing`
(Supplier CRUD; PurchaseInvoice DRAFT→CONFIRMED pipeline posting PURCHASE
movements at landed unit cost — exact-paisa largest-remainder allocation of
other_charges — with StockBatch rows and a PURCHASE numbering series; VAT rule
mirrors sales), `apps/payments` (append-only Payment with mandatory
Idempotency-Key + PaymentAllocation so receipts reduce dues WITHOUT touching
completed invoices — outstanding is ledger-derived (dues − credit notes −
receipts) in one canonical selector; linked negative counter-entry reversals
with audit and `payment.reverse`; party ledgers and receivables aging;
CashSession day-close with persisted tender-aware expected cash, supplier cash
outflows, variance snapshot, and an open-session guard on POS sale completion),
`apps/reports`
(read-only selectors, no models: daily/monthly/item sales, stock summary /
low / dead stock, profit pinned to cost_at_sale and gated on report.profit +
pricing.view_cost, dues reusing canonical outstanding, sales+purchase VAT
registers — all plain GROUP BYs on the denormalized BS columns; profit_report
now also computes net = gross − expenses), `apps/expenses` (ExpenseCategory
lookup + Expense CRUD with AD/BS filters, summary by category/BS month;
ordinary CRUD records, no ledger), `apps/audit` (append-only AuditLog with
REVOKE UPDATE/DELETE — explicit audit() calls in services, never signals;
wired: price.set, price.set_bounds, stock.adjust, stock.write_off,
sale.cancel_held; request context middleware stamps IP, user agent, and signed
support actor claims; GET /audit/ gated on settings.manage), `apps/notifications`
(RLS-protected SmsLog; receipt template + Nepal mobile normalization;
vendor-neutral provider contract per ADR 0004; no-network local provider;
Celery delivery with bounded retry and duplicate-task protection; receipt
queue gated on sale.create and delivery log gated on settings.manage). Plan
enforcement is active above route permissions: unexpired tenant overrides win
over plan JSON; disabled SMS/profit/VAT/multi-branch/custom-rate routes return
402; service writes hard-block staff/item/rate-type/SMS limits under tenant-row
locks; invoice volume remains soft with 80%/100% response warnings; Celery beat
writes nightly TenantUsageSnapshot rows under per-tenant RLS context. Shared
API plumbing lives in
`core/responses.py` (envelope + ServiceError) and `core/pagination.py`. The
tenant-isolation + RLS suite runs against real Postgres in CI. The remaining
`apps/compliance` package is an empty skeleton per §8.2. When implementation continues,
follow the structure and rules specified in `docs/SYSTEM_DESIGN.md` and keep this
file current.

## Project overview

Multi-tenant SaaS for clothing retail shops in Nepal. Core characteristics:

- **Subdomain-per-shop tenancy** (`<slug>.dokan.com.np`), isolated with PostgreSQL
  Row-Level Security.
- **Nepali calendar (BS) native**: Bikram Sambat dates and the Nepali fiscal year
  (Shrawan 1 → Ashad end) are first-class in storage, reporting, and UI.
- **IRD-compliant billing**: gapless invoice numbering, no bill deletion (credit notes
  only), VAT registers, CBMS sync (Phase 2).
- **Offline-tolerant POS** (PWA) for load shedding and ISP drops (Phase 3).
- Nepal-specific payments (eSewa / Khalti / Fonepay QR), SMS receipts, and the
  udharo (credit/khata) ledger that Nepali retail runs on.

## Planned technology stack

| Layer | Choice |
|---|---|
| Backend | Django 5 + Django REST Framework, PostgreSQL 16, Redis, Celery |
| Frontend | Vite + React + TypeScript, PWA, TanStack Query (server state), Zustand (cart/UI), Tailwind |
| Tenant isolation | Shared schema + `tenant_id` column + **Postgres RLS** (`FORCE ROW LEVEL SECURITY`) |
| BS dates | Python `nepali-datetime`, TS `nepali-date-converter` (same conversion-table version pinned on both) |
| Auth | Django auth + SimpleJWT (access 30 min, refresh 30 days, rotating); never custom auth |
| API contract | OpenAPI 3.1 generated from DRF; typed TS client generated from it — no hand-written API types |
| Deploy (Phase 1) | Single VPS: Docker Compose with Caddy (wildcard TLS), Gunicorn/Uvicorn, Celery + beat, Postgres, Redis |

## Architecture and code organization

### Backend layering (strict)

```
HTTP → urls → view (thin) → service (writes) / selector (reads) → model
                   ↑                ↑
              serializer      domain rules, transactions
```

- **Views** parse, authorize, delegate. No business logic, no ORM writes.
- **Services** own transactions and invariants. Business validation lives here, not in
  serializers.
- **Selectors** own reads/reporting and take an explicit `user` argument so cost columns
  can be dropped at the source.
- **Serializers** validate shape only.
- **Models** hold fields and constraints; no fat models.

### Layout (per `docs/SYSTEM_DESIGN.md` §8.2–8.3)

- `backend/config/` — settings split (`base/dev/prod/test`), urls, celery.
- `backend/core/` — the platform spine: `calendar/bs.py` (the ONLY place BS conversion
  exists), `db/rls.py`, middleware (`tenant`, `audit`, `plan_gate`), `permissions/`,
  `money.py`, `numbering.py`, base models (`TenantScopedModel`).
- `backend/apps/` — one Django app per module: `tenants`, `platformadmin`, `accounts`,
  `catalog`, `pricing`, `inventory`, `purchasing`, `sales`, `customers`, `payments`,
  `expenses`, `reports`, `audit`, `notifications`, `compliance`.
- Each app: `models.py · services.py · selectors.py · serializers.py · views.py ·
  urls.py · permissions.py · admin.py · tasks.py · tests/`.
- `frontend/src/` — `app/` (router/providers), `features/` (per-module UI; `billing/`
  is the most optimized), `components/ui/`, `lib/` (`api/` generated client, `bs/`,
  `offline/`, `permissions.ts`, `money.ts`), `hooks/`, `stores/`.
- **Files stay under 400 lines.** When a services file grows, split by use case
  (`sales/services/{create_sale,void_sale,returns,exchange}.py`), not by layer.

## Non-negotiable invariants

1. **Stock changes only via `stock_movement`** (immutable ledger). `stock_level` is a
   projection written in the same transaction; a monthly job re-derives it and alerts
   on drift.
2. **`cost_at_sale` is snapshotted at sale time.** Later cost changes must never rewrite
   history.
3. **Completed invoices are never updated or deleted.** Corrections happen via RETURN /
   credit note (accounting + IRD requirement).
4. **Tenant comes only from the subdomain** — never from a header, body, or query param.
   Middleware sets `SET LOCAL app.tenant_id` inside the request transaction.
5. **App DB role is non-superuser, non-owner** with `FORCE ROW LEVEL SECURITY` on every
   tenant-scoped table; migrations run as a separate privileged role.
6. **Every composite index leads with `tenant_id`** so RLS predicates are index-covered.
7. **Audit log is append-only** (`REVOKE UPDATE, DELETE` from the app role), written by
   explicit `audit(...)` calls in services — never by signals.
8. **`POST /sales` and `POST /payments` require a mandatory `Idempotency-Key` header**;
   replays return the original record with 200.
9. **BS conversion lives only in `core/calendar/bs.py`** (backend) and `lib/bs/`
   (frontend). API always exchanges AD ISO strings; BS is a presentation/reporting
   concern. `business_date_bs` (`char(10)`, zero-padded) and `fiscal_year_bs`
   (`char(7)`, e.g. `'2082-83'`) are denormalized onto every transaction row at write
   time.
10. **Cost price must never leak** to users without `pricing.view_cost` — not in
    serializer fields, selector querysets, UI components, or even error messages
    ("below cost" is itself a disclosure).
11. **Money is Decimal** via `core/money.py`; display uses Nepali lakh/crore grouping
    (`1,23,456`) with optional Devanagari numerals.
12. **POS sale completion requires an open `CashSession`** for the branch. Holding a
    bill remains allowed without a session, and idempotent replays return the original
    invoice even after the session closes.

## Testing strategy

| Layer | Tool | Target |
|---|---|---|
| Unit | pytest | Price resolution matrix, min/max enforcement, BS conversion golden file, stock math, money rounding, gapless numbering under concurrency |
| Integration | pytest + DRF `APIClient` + factory_boy | Every endpoint: happy + auth-denied + validation |
| Tenant isolation | pytest, parametrized over every tenant-scoped model | Tenant A gets 404/empty for every row of tenant B. Runs in CI on every PR — **this is the test that protects the business** |
| Concurrency | pytest + threads | Two simultaneous sales of the last item; two bills grabbing the same invoice number |
| E2E | Playwright | Login → scan → bill → print; return; stock matrix entry; report by BS range |
| Load | k6 | `POST /sales` at 50 rps; `GET /items/lookup` at 200 rps |

- Coverage floor 80%, but **100% on `pricing/`, `sales/services/`, `inventory/services/`,
  and `core/calendar/`** — those four are where a bug costs the shop money.
- BS date tests use a golden fixture (~500 known AD↔BS pairs) shared by backend and
  frontend.
- Factories hang off a `TenantFactory` so no test can create cross-tenant data.
- The tenant-isolation suite and BS golden-file tests must land **before** the first
  business feature.

## Git and development workflow

- **Trunk-based**: `main` always deployable and protected; short branches
  (`feat/…`, `fix/…`, `chore/…`) live ≤ 3 days. **Small atomic commits per
  logical unit on the branch** (e.g. `feat(sales): invoice models and
  migration`, `feat(sales): gapless numbering service`); PRs are merged
  **preserving those commits** (no squash — the unit history is the review
  trail). Delete branch on merge.
- **Conventional Commits**, scope = app name, e.g. `feat(sales): add split payment with
  esewa and cash`. Body answers *why*, not *what*.
- **CI gate (all required)**: lint (ruff/eslint), format check, type check (mypy/tsc),
  tests, coverage ≥ 80%, tenant-isolation suite, `makemigrations --check --dry-run`,
  secret scan (gitleaks).
- **Two approvers** for anything touching `pricing/`, `sales/services/`,
  `core/permissions/`, or migrations.
- Releases: SemVer tags on `main`; `CHANGELOG.md` from conventional commits plus a
  plain-language "what shopkeepers get" section.

### Migration discipline

- One logical migration per PR; never edit a migration that has run in prod.
- Additive first: add nullable column → backfill separately → make non-null later.
  Two-phase deploys for destructive changes.
- No `RunPython` without `reverse_code`; data migrations for tables > 100k rows run as
  Celery tasks; index creation uses `CONCURRENTLY` (`AddIndexConcurrently`,
  `atomic = False`).

## Security considerations

- Platform users (`platform_user`) and tenant users (`user`) are **separate tables with
  separate token audiences**. A super admin never gets a row in a tenant's user table.
- Super-admin portal lives on the `admin.` host only: separate auth realm, IP allowlist,
  mandatory 2FA.
- **Impersonation (support access) is security-critical**: reason required (min 20
  chars), read-only by default, max 60 min, short-lived token with `act` claim,
  server-side jti denylist, persistent red banner in the tenant UI, owner notified,
  blocked actions regardless of scope (password changes, user management, plan/billing
  changes, full customer export, tenant deletion, disabling audit).
- JWT is bound to one tenant; reuse on another subdomain is a hard 403 + audit event.
- Permission checks are enforced redundantly at four layers: DRF route permission,
  serializer field, service, and queryset/selector. `PlanGate` sits above all four.
- Application logs must never contain PII, cost figures, or tokens. Secrets come from
  Docker secrets/SOPS — never the repo; startup asserts all required secrets are present.
- Rate limits: 300 req/min/user, 60/min on auth, 20/min on report generation.
- PgBouncer must run in **transaction** pooling mode (`SET LOCAL` is per-transaction);
  session mode would leak tenant context across requests.

## Documentation conventions

- Docs live in `/docs` (plus `README.md` and `CHANGELOG.md` at the root).
- Rule: **a doc that isn't updated in the PR that invalidated it gets deleted, not
  fixed later.** Stale docs are worse than none.
- The design lists 19 planned docs (`ARCHITECTURE.md`, `MULTI_TENANCY.md`,
  `RATE_RULES.md`, `NEPALI_LOCALIZATION.md`, `COMPLIANCE_IRD.md`, ADRs in
  `docs/DECISIONS/`, etc.). Start with README, ARCHITECTURE, MULTI_TENANCY,
  DATABASE_SCHEMA, RATE_RULES, GIT_WORKFLOW, ROADMAP; add the rest as code lands.

## Deliberately NOT built (do not reintroduce)

Microservices (modular monolith), generic EAV attributes (size/color columns +
`attributes jsonb`), FIFO/LIFO costing (moving weighted average), full double-entry
accounting, event sourcing beyond the stock ledger, custom auth, schema-per-tenant,
GraphQL, Kubernetes (Phase 1), a from-scratch design system. See
`docs/SYSTEM_DESIGN.md` §12 for the revive conditions.

## Language and localization

Code, comments, and documentation are in **English**. The UI is bilingual Nepali +
English (Nepali labels for counter-facing screens; Devanagari numerals optional).
Currency is NPR. Timezone is `Asia/Kathmandu`. See `docs/SYSTEM_DESIGN.md` §6–7 for
the BS calendar and UI conventions before touching anything date- or money-related.
