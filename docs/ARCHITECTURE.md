# Architecture

Why the system is shaped the way it is. This doc explains structure and reasoning;
the authoritative specification remains `docs/SYSTEM_DESIGN.md` (§2, §8). If this
doc and the code disagree, the code is right — update or delete this doc in the
same PR that changes the code.

---

## 1. System context

A multi-tenant SaaS for clothing retail shops in Nepal. Each shop is a **tenant**,
reached at its own subdomain (`<slug>.dokan.com.np`). One deployment serves all
shops from one Postgres database, one Django application, and one React frontend
build.

```
                        ┌────────────────────────────────────────────┐
                        │                Internet                     │
                        └───────┬───────────────────┬────────────────┘
                                │                   │
                    shop staff / owner       super admin (admin. host)
                                │                   │
                                ▼                   ▼
                        ┌───────────────────────────────────────────┐
                        │  Caddy — wildcard TLS *.dokan.com.np       │
                        └───────────────────┬───────────────────────┘
                                            │
              ┌─────────────────────────────┼──────────────────────────────┐
              │                             │                              │
              ▼                             ▼                              ▼
   React PWA (static, CDN)        Django + DRF (Gunicorn/Uvicorn)   Celery worker + beat
                                            │                     (reports, SMS, IRD sync,
                       ┌────────────────────┤                      rollups)
                       ▼                    ▼
                 PostgreSQL 16           Redis
          (RLS-enforced tenancy,    (cache, tenant lookup,
           single shared schema)     sessions, Celery broker,
                                     rate limits, jti denylist)
```

External services: eSewa / Khalti / Fonepay QR (payments), a Nepali SMS provider
(receipts, OTP — vendor chosen at integration time, see ADR 0004), Sentry
(errors), S3-compatible object storage (static/media, backups).

Actors and their realms (SYSTEM_DESIGN §2.4):

| Actor | Table | Host |
|---|---|---|
| Super Admin, Support Agent, Billing | `platform_user` | `admin.dokan.com.np` only |
| Tenant Owner, Manager, Cashier, Stock Keeper, Accountant | `user` | `<slug>.dokan.com.np` |

Platform users and tenant users are **separate tables with separate JWT audiences**.
A super admin never has a row in a tenant's `user` table. See
`docs/MULTI_TENANCY.md` and ADR 0001.

---

## 2. Request lifecycle

Every tenant API request flows through the same pipeline (SYSTEM_DESIGN §2.2).
Each stage can reject; none may be skipped.

```
GET https://shreeganesh.dokan.com.np/api/v1/sales
        │
        ▼
[Caddy]  wildcard TLS termination (Let's Encrypt DNS-01), reverse proxy to web
        │
        ▼
[TenantMiddleware]
   1. Parse subdomain from Host                → "shreeganesh"
   2. Look up tenant (Redis, 5 min TTL; miss → Postgres)
   3. Reject if status != ACTIVE               → 402 (past due) / 423 (suspended)
   4. Open request transaction; SET LOCAL app.tenant_id = '<uuid>'
        │
        ▼
[Auth]  SimpleJWT access token → user
        Assert user.tenant_id == request.tenant_id (hard 403 + audit event on mismatch)
        Resolve token.sid → active auth_session (missing/revoked/expired → 401)
        │
        ▼
[PlanGate]  Tenant's plan includes the feature this route requires?
        No → 402 with machine-readable code; UI shows locked nav with "Upgrade" tag
        │
        ▼
[DRF permission]  user has e.g. `sale.create`?
        │
        ▼
[Serializer]  shape validation only (no business rules, no cost fields for
              users without pricing.view_cost)
        │
        ▼
[Service (writes) / Selector (reads)]
        Service: one function, one transaction — reserve stock → write
        stock_movement rows → project stock_level → write invoice → write
        party ledger → write payment → bump number_sequence → audit(...)
        Selector: aggregate queryset taking explicit `user`; cost columns
        dropped at the source for unprivileged users
        │
        ▼
Response envelope: { "data": ..., "meta": {...}, "error": null }
```

Non-negotiables (see `docs/MULTI_TENANCY.md` for the full contract):

- Tenant is derived **only** from the subdomain — never a header, body, path, or
  query param.
- `SET LOCAL app.tenant_id` runs inside the request transaction; PgBouncer must
  run in **transaction** pooling mode.
- A JWT is bound to one tenant. Reuse on another subdomain is a hard 403 and an
  audit event.
- Normal tenant JWTs are also bound to an RLS-protected registered device.
  Logout and device/password revocation invalidate access and refresh tokens
  immediately; support impersonation retains its separate Redis+jti path.

---

## 3. Backend layering — the rules

```
HTTP → urls → view (thin) → service (writes) / selector (reads) → model
                   ↑                ↑
              serializer      domain rules, transactions
```

| Layer | Does | Never does |
|---|---|---|
| **View** | Parse input, authorize, delegate to one service/selector, shape the response | Business logic, ORM writes, transactions |
| **Serializer** | Validate request/response **shape**; drop cost fields without `pricing.view_cost` | Business validation (it can't see the transaction) |
| **Service** | Owns transactions and invariants; all writes; business validation (price floor, credit limit, stock); explicit `audit(...)` calls | Read-only reporting queries |
| **Selector** | Owns reads and reporting; takes an explicit `user` argument so cost columns are excluded at the source | Writes of any kind |
| **Model** | Fields, constraints, indexes, trivial computed properties | "Fat model" business logic |

Why: business rules that live in views or serializers get bypassed by the second
caller (management command, Celery task, offline sync). Rules that live in
services are enforced for every caller. Audit is written explicitly in services,
never by signals — signals fire on migrations, fixtures, and shell commands and
produce garbage audit trails.

Example — creating a sale is one service function, one transaction:

```
create_sale(...):
    with transaction.atomic():
        rows = lock variants; check stock
        write stock_movement (SALE, qty_delta<0)      # immutable ledger
        update stock_level projection                  # same transaction
        resolve prices (pricing service), enforce min/max
        invoice_no = next_number(tenant, branch, SALE, fiscal_year_bs)  # row-locked
        write sales_invoice + items (cost_at_sale snapshot)
        write party_ledger_entry, payment rows
        audit("sale.create", before=None, after=invoice)
```

The POS HTTP completion paths pass the branch through the payments service's open
cash-session guard before stock is posted. `POST /sales/hold` remains available while
the drawer is closed, and idempotent replays return the original invoice without
re-running the guard.

---

## 4. Module map

One Django app per module under `backend/apps/` (SYSTEM_DESIGN §8.2). Each app:
`models.py · services.py · selectors.py · serializers.py · views.py · urls.py ·
permissions.py · admin.py · tasks.py · tests/`. Files stay under 400 lines; a
growing `services.py` splits by use case (`sales/services/{create_sale,void_sale,
returns,exchange}.py`), never by layer.

| App | Owns | Boundary rule |
|---|---|---|
| `tenants` | tenant, plan, subscription, provisioning | Platform-scope models; not reachable from tenant requests |
| `platformadmin` | super-admin API, impersonation | `admin.` host only, separate auth realm |
| `accounts` | user, role, permission, auth (phone login, JWT) | Owns the `user` table; other apps reference, never extend |
| `catalog` | category, brand, size chart, item, variant, barcodes | Variant is the only sellable/stockable unit |
| `pricing` | rate_type, item_price, price resolution engine | Only place prices are resolved; sales calls it, never reimplements |
| `inventory` | stock_level, stock_movement ledger, transfers, counts | Only writer of stock quantities, via `stock_movement` |
| `purchasing` | supplier, purchase invoice, landed cost | Writes PURCHASE movements through inventory's service |
| `sales` | invoice, return, exchange, held bill, numbering | Never edits completed invoices; corrections are RETURN docs |
| `customers` | customer and credit policy | Loyalty remains roadmap scope; dues use the payment selector |
| `payments` | payment, allocation, reversal, cash session | Ledger-derived balances; gateway adapters remain roadmap scope |
| `expenses` | expense tracking | Feeds net-profit reports |
| `reports` | selectors and permission-safe exports | Intentionally model-free until the documented rollup trigger |
| `audit` | audit_log, query API | Append-only store; written only via `audit(...)` |
| `notifications` | SMS/email, templates, provider abstraction | Vendor-agnostic interface (ADR 0004) |
| `compliance` | durable IRD/CBMS sync queue | Frozen payloads and retry state; live provider is deployment integration |
| `storefront` | public catalog, settings, OTP customers, orders | Resolves `*.shop.<root>` itself, opens RLS context, and never exposes cost or exact stock |

Cross-app rule: apps call each other **only through services and selectors**,
never through another app's models in a write path. `core/` holds the platform
spine shared by all apps:

```
backend/core/
├── calendar/bs.py        # the ONLY place BS conversion exists
├── db/rls.py             # SET LOCAL app.tenant_id helpers
├── middleware/           # tenant, audit, plan_gate
├── permissions/          # permission catalog (single source of truth), DRF glue
├── money.py              # Decimal money, rounding, Nepali lakh/crore formatting
├── numbering.py          # gapless per-branch per-fiscal-year sequences
├── exceptions.py  pagination.py  responses.py
└── models.py             # TenantScopedModel, TimestampedModel
```

---

## 5. Frontend architecture

Vite + React + TypeScript SPA, installable PWA (SYSTEM_DESIGN §8.3). No SSR — an
authenticated POS gains nothing from it.

```
frontend/src/
├── app/                  # router, providers, error boundary
├── features/             # one folder per module; billing/ is the most optimised
├── components/ui/        # Button, Input, DataTable, Money, BSDatePicker, Modal
├── lib/
│   ├── api/              # typed client GENERATED from OpenAPI — never hand-written
│   ├── bs/               # BS conversion/formatting; mirrors backend contract,
│   │                     # same golden fixture, same pinned conversion table
│   ├── offline/          # Dexie queue, sync engine, conflict policy (Phase 3)
│   ├── permissions.ts    # <Can perm="pricing.view_cost"> — unrendered, not CSS-hidden
│   └── money.ts          # Nepali lakh grouping, optional Devanagari numerals
├── hooks/  stores/       # TanStack Query (server state), Zustand (cart/UI state)
└── styles/tokens.css
```

Decisions that follow from this:

- **Server state vs UI state is explicit**: TanStack Query for anything from the
  API; Zustand for the cart and local UI. No third store.
- **The billing feature is the product's hot path**: barcode scan → line add with
  zero mouse, search auto-focused, works at 1024×768.
- **Cost-price visibility is enforced in the UI too**: components that show cost
  are not rendered for users without `pricing.view_cost` — hiding with CSS leaks
  through devtools.
- The super-admin portal ships in the **same build** under `/admin`, mounted only
  on the `admin.` host: one deploy, one auth library, one design system.
- API types come from the generated client only (ADR 0002).
- Tenant and admin portals plus feature pages are route-lazy. CI rejects a
  production initial JavaScript entry above 500 KiB so feature-only code cannot
  silently return to the startup path.
- The anonymous customer store is a separate Vite SPA under `storefront/`, with
  its own host namespace and `aurora`/`bazaar` template registry.

---

## 6. Data & consistency invariants

These twelve invariants must never be violated. Code comments cite them as
"ARCHITECTURE §6 invariant N"; reviews reject anything that breaks one.

1. **Stock changes only via `stock_movement`** (immutable, append-only ledger).
   `stock_level` is a projection written in the same transaction; a monthly job
   re-derives it from the ledger and alerts on drift.
2. **`cost_at_sale` is snapshotted at sale time.** Later cost changes never
   rewrite history — profit reports are stable.
3. **Completed invoices are never updated or deleted.** Corrections happen via
   RETURN / credit note (accounting + IRD requirement).
4. **Tenant comes only from the subdomain** — never from a header, body, or
   query param. Middleware sets `SET LOCAL app.tenant_id` inside the request
   transaction.
5. **App DB role is non-superuser, non-owner** with `FORCE ROW LEVEL SECURITY`
   on every tenant-scoped table; migrations run as a separate privileged role.
6. **Every composite index leads with `tenant_id`** so RLS predicates are
   index-covered.
7. **Audit log is append-only** (`REVOKE UPDATE, DELETE` from the app role),
   written by explicit `audit(...)` calls in services — never by signals.
8. **`POST /sales` and `POST /payments` require a mandatory `Idempotency-Key`
   header**; the key is stored on the record, unique per tenant, and a replay
   returns the original record with 200.
9. **BS conversion lives only in `core/calendar/bs.py`** (backend) and
   `lib/bs/` (frontend). The API always exchanges AD ISO strings; BS is a
   presentation/reporting concern. `business_date_bs` (`char(10)`) and
   `fiscal_year_bs` (`char(7)`) are denormalized onto every transaction row at
   write time, so reports are plain indexed range scans with no conversion in
   SQL.
10. **Cost price must never leak** to users without `pricing.view_cost` — not
    in serializer fields, selector querysets, UI components, or even error
    messages ("below cost" is itself a disclosure).
11. **Money is Decimal** via `core/money.py`; display uses Nepali lakh/crore
    grouping (`1,23,456`) with optional Devanagari numerals.
12. **POS sale completion requires an open `CashSession`** for the branch.
    Holding a bill remains allowed without a session, and idempotent replays
    return the original invoice even after the session closes.

Supporting mechanism:

- **Gapless invoice numbering**: row-locked `number_sequence` per (tenant,
  branch, doc_type, fiscal_year_bs) — DB sequences leave gaps on rollback, which
  IRD does not accept.

---

## 7. Deployment topology (Phase 1)

One VPS (8 GB / 4 vCPU, Singapore or Mumbai ≈ 60–90 ms RTT to Kathmandu),
Docker Compose. Serves ~300 shops comfortably.

```
Caddy (wildcard TLS, *.dokan.com.np via DNS-01)
  ├─ web       : Gunicorn/Uvicorn × 4          (Django)
  ├─ worker    : Celery × 2                    (reports, SMS, IRD sync, rollups)
  ├─ beat      : Celery beat                   (nightly usage snapshots, rollups, reconciliation)
  ├─ pgbouncer : 1.25.2, transaction mode      (app role only; digest-pinned)
  ├─ postgres  : 16, WAL archiving on          (private direct path for privileged ops)
  └─ redis     : cache, sessions, celery broker, rate limit, jti denylist
```

Static/media on S3-compatible storage (Cloudflare R2) behind a CDN.

| Concern | Approach |
|---|---|
| Backups | `pg_dump` nightly + continuous WAL to object storage; **restore drill on the 1st of every month** |
| Zero-downtime | Rolling restart behind Caddy; migrations backward-compatible for one release |
| Monitoring | privacy-filtered Sentry; Prometheus + exporters; Grafana; Loki + Alloy; Uptime Kuma |
| Alerting | 5xx/latency, worker and queue health, DB/Redis/disk saturation, recovery freshness, external HTTP/TLS |
| Secrets | External `.env`/SOPS input is mapped through explicit per-service allowlists; startup asserts required secrets, and CI rejects cross-boundary exposure |
| Environments | `dev` (local compose) → `staging` (real subdomain, anonymised data) → `prod` |

**Trigger points for growing past this** (do not build early): managed Postgres +
read replica when reporting contends with OLTP (~Phase 3); `fiscal_year_bs`
partitioning of `sales_invoice`/`stock_movement` when the largest tenant passes
~5M rows; container orchestration when one VPS stops being enough. See
SYSTEM_DESIGN §12 for the full "deliberately not built" list.

---

## 8. Cross-cutting concerns

- **Permissions**: enforced redundantly at four layers — DRF route permission,
  serializer field, service, queryset/selector — with `PlanGate` above all four.
  Catalog lives in `core/permissions/catalog.py`; cached per user in Redis
  (5 min TTL).
- **Audit vs logs**: application logs (stdout → Loki, 30 days, never PII/cost/
  tokens) are for debugging; `audit_log` (Postgres, append-only, `REVOKE UPDATE,
  DELETE` from app role, retained per plan, min 7 years for financial rows) is
  for accountability. Only explicitly privacy-approved containers are collected;
  request correlation uses a validated UUID4 `X-Request-ID`, never a tenant or
  user label.
- **Health and metrics**: `/api/live` proves only that the process can answer;
  `/api/health` checks PostgreSQL and Redis readiness. Prometheus reads the
  private `/api/metrics` endpoint using bounded method/route/status labels;
  Caddy denies that endpoint publicly. Recovery scripts publish success
  timestamps through node exporter's textfile collector, and `dokan_monitor`
  has `pg_monitor` but no business-table grants or RLS bypass.
- **Error telemetry**: Sentry is optional and fails inert without a DSN. Its
  event filter removes bodies, URLs/query strings, cookies, user identity,
  arbitrary messages, exception text, non-allowlisted headers, secrets and
  financial fields before transmission.
- **Rate limits**: 300 req/min/user, 60/min on auth, 20/min on report generation.
- **Reports**: Phase 1 queries the OLTP directly via selectors; Phase 2 adds
  nightly rollups (`daily_sales_summary`, `daily_item_summary`) when a tenant
  crosses ~100k invoice lines; long reports run async via Celery with a download
  link.
- **API contract**: envelope `{data, meta, error}` with machine-readable error
  codes; cursor pagination on transaction lists; OpenAPI 3.1 generated from DRF
  plus committed TypeScript declarations, both regenerated and diff-checked in
  CI (ADR 0002).
- **Coverage boundary**: CI keeps an 80% branch-aware repository floor and
  requires zero missing lines or branches in pricing, sales services, the BS
  calendar, and every inventory write module. The explicit
  `scripts/check_critical_coverage.py` gate also fails if a critical module is
  absent from the coverage report.

---

## 9. Key decisions and rejected alternatives

Recorded as ADRs in `docs/DECISIONS/`:

- [0001 — JWT claim shape and token audiences](DECISIONS/0001-jwt-claim-shape.md)
- [0002 — API contract toolchain](DECISIONS/0002-api-contract-toolchain.md)
- [0003 — Barcode format](DECISIONS/0003-barcode-format.md)
- [0004 — SMS gateway abstraction](DECISIONS/0004-sms-gateway.md)

Larger design-level choices (RLS over schema-per-tenant, denormalized BS dates,
weighted-average costing, PWA over native, monolith over microservices) are
decided in `docs/SYSTEM_DESIGN.md` §0 and §12, including their revive conditions.
