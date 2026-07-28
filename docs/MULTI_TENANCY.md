# Multi-Tenancy

The rules nobody may break. Tenant isolation is the feature that protects the
business; everything in this doc is enforced by tests that run in CI on every PR.
The authoritative design is `docs/SYSTEM_DESIGN.md` §2.

---

## 1. Isolation model

**Chosen: shared schema + `tenant_id` column on every tenant-scoped table +
PostgreSQL Row-Level Security (RLS), with `FORCE ROW LEVEL SECURITY`.**

| Option | Isolation | Migration cost | Ops cost | Verdict |
|---|---|---|---|---|
| Shared schema, `tenant_id` only | App-enforced (fragile) | 1 run | Low | **Rejected** — one missing `.filter()` = data breach |
| **Shared schema + `tenant_id` + RLS** | **DB-enforced** | **1 run** | **Low** | **Chosen** |
| Schema per tenant | DB-enforced | N runs (slow past ~300 tenants) | Medium | Later, enterprise tenants only |
| Database per tenant | Total | N runs | High | Only if contractually demanded |

RLS turns tenant isolation from a code-review problem into a database
constraint. A forgotten `.filter(tenant_id=...)` in application code is then
structurally unable to leak — the database refuses the row before the ORM ever
sees it.

Consequences we accept:

- Every tenant-scoped table carries `tenant_id uuid NOT NULL`, and every
  composite index on it **leads with `tenant_id`** so RLS predicates are
  index-covered.
- Migrations must create the policy on every new tenant-scoped table (checklist
  in §8). A table without a policy is a silent hole.
- Cross-tenant reporting simply does not exist in the tenant app. Platform-wide
  aggregates belong to the super-admin service, which connects with a different
  role.

---

## 2. The RLS pattern — exact SQL

Applied to every tenant-scoped table, without exception:

```sql
ALTER TABLE sales_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice FORCE  ROW LEVEL SECURITY;   -- applies to the table owner too

CREATE POLICY tenant_isolation ON sales_invoice
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

> The `NULLIF(..., '')` guard is load-bearing: after a rolled-back transaction,
> Postgres can leave a custom GUC set to `''` rather than NULL, and `''::uuid`
> raises instead of failing closed. With PgBouncer transaction pooling, a
> leftover `''` on a reused server connection would turn every query into an
> error instead of a safe zero-row result.

Rules:

- `FORCE ROW LEVEL SECURITY` is **mandatory**. Without it, the table owner
  bypasses policies — and since one migration role owns all tables, that would
  be most of the access paths.
- `WITH CHECK` is as important as `USING`: it blocks *writing* a row into
  another tenant, not just reading one.
- `current_setting('app.tenant_id', true)` — the second argument (`true`) makes
  a missing setting return NULL rather than raise. NULL never equals a real
  `tenant_id`, so **an unset context denies everything**. That fail-closed
  behaviour is deliberate: a request that somehow reached the ORM without the
  middleware setting context sees zero rows, not all rows.
- One policy per table, named `tenant_isolation`, covering ALL operations
  (SELECT/INSERT/UPDATE/DELETE). No per-command policies — more policies means
  more ways to forget one.

---

## 3. Database roles

| Role | Used by | Privileges |
|---|---|---|
| `app_role` | web, worker, beat, all request traffic | `SELECT, INSERT, UPDATE, DELETE` on tenant tables; **non-superuser, non-owner**; `UPDATE, DELETE` **revoked** on `audit_log`; **no** `BYPASSRLS` |
| `migration_role` | `manage.py migrate`, one-off ops | Owns the tables; privileged; allowed to bypass RLS for DDL and data backfills |

Why the split:

- **Superusers bypass RLS silently.** The application role must never be a
  superuser — that is the single most common way RLS deployments quietly stop
  isolating.
- The app role must also not **own** the tables: combined with `FORCE`, the
  app role is then always subject to policies.
- Migrations need to create/alter tables and bypass RLS for backfills, so they
  run as a separate privileged role with its own credentials (Docker secrets /
  SOPS, like everything else).
- `audit_log` additionally gets `REVOKE UPDATE, DELETE FROM app_role` — the
  audit trail is append-only at the database level, not by convention.

---

## 4. Request-time tenant context

`TenantMiddleware` (see `docs/ARCHITECTURE.md` §2):

1. Parse the subdomain from the `Host` header → slug.
2. Resolve the tenant (Redis cache, 5 min TTL; miss → Postgres `tenant` table).
3. Reject non-active tenants: `402` for billing states, `423` for suspended,
   with a friendly page.
4. Open the request transaction and run:

   ```sql
   SET LOCAL app.tenant_id = '<tenant-uuid>';
   ```

`SET LOCAL` (not `SET`) scopes the setting to the current transaction. When the
request's transaction commits or rolls back, the setting is gone.

**Non-negotiable: the tenant is derived only from the subdomain.** Never from a
header (`X-Tenant-ID`), request body, URL path, or query param. Any code that
accepts tenant identity from the client is a critical vulnerability.

### PgBouncer: transaction mode only

`SET LOCAL` is per-transaction, which is exactly why it is safe behind a
connection pooler **in transaction pooling mode**: each request transaction gets
a server connection, sets its tenant, and the setting evaporates at commit.

Session pooling mode + `SET` (or a leaked `SET LOCAL` outside a transaction)
would carry tenant context from one request to the next on the same server
connection — a cross-tenant leak with no code change. Therefore:

- PgBouncer runs with `pool_mode = transaction`. This is asserted in deployment
  config and in the deployment checklist.
- Nothing in the codebase uses bare `SET app.tenant_id` — grep-able rule.
- Features incompatible with transaction mode (prepared statements, session
  advisory locks, `LISTEN/NOTIFY` on pooled connections) must not be introduced
  into request paths. Use `SELECT pg_advisory_xact_lock(...)` (transaction-scoped)
  where locking is needed, e.g. invoice numbering uses row locks instead.

---

## 5. Platform tables live outside RLS

`plan`, `tenant`, `tenant_subscription`, `tenant_feature_override`,
`tenant_usage_snapshot`, `platform_user`, `impersonation_session`, and
`platform_audit_log` have **no `tenant_id` and no RLS**. They are reachable only
from the super-admin service on the `admin.` host:

- separate auth realm, separate JWT audience (ADR 0001),
- IP allowlist and mandatory 2FA at the portal,
- tenant resolution itself needs the `tenant` table before any tenant context
  exists — it cannot be behind its own RLS.

Tenant requests must have **no code path** that queries platform tables other
than the middleware's cached tenant lookup.

---

## 6. Identity and token binding

- Platform users (`platform_user`) and tenant users (`user`) are **separate
  tables with separate token audiences**. A super admin never has a row in a
  tenant's `user` table — this prevents the "support account left behind after
  offboarding" hole.
- Every JWT carries a `tenant` claim (uuid). After authentication, the request
  asserts `token.tenant == request.tenant` (from the subdomain). **A token
  replayed against another subdomain is a hard 403 plus an audit event** — token
  theft across tenants must be loud, not silent.
- Impersonation tokens add an `act` claim (the platform user acting), are
  read-only by default, expire in ≤ 60 minutes, and are jti-denylisted in Redis
  so "End now" is instant. Full flow: SYSTEM_DESIGN §2.6; claims: ADR 0001.

---

## 7. Subdomains and slugs

Host map (SYSTEM_DESIGN §2.3): `www` marketing/signup, `app` tenant selector,
`<slug>` tenant app, `admin` super-admin portal, `api` optional public API.

Slug rules:

- 3–30 chars, `[a-z0-9-]`, unique, **immutable after creation** — changing a
  slug breaks bookmarks, cached QR codes, and printed receipts.
- Reserved blocklist, rejected at provisioning:
  `www, app, api, admin, mail, static, cdn, blog, help, status, staging`.
- Custom domains (`billing.myshop.com.np`) are a Phase 3 add-on with per-domain
  certificate issuance; the middleware must still resolve host → tenant the same
  way, so host parsing is the only lookup point.

Provisioning / suspension / deletion:

- **Provision**: super admin (or Phase 2 self-serve signup) creates the `tenant`
  row + slug + plan, then the default branch, owner user, system roles, and
  number sequences. No per-tenant DDL is needed — that is the point of shared
  schema.
- **Suspend / reactivate**: a `tenant.status` change; the middleware returns
  423/402 and the shop's data is untouched.
- **Delete**: soft delete (`deleted_at`). Hard deletion is a manual, audited
  ops procedure after the retention window, never an API action.
- **Export**: `manage.py export_tenant <slug>` → zip of CSVs. Shops will ask;
  it must exist before they do.

---

## 8. Checklist: adding a new tenant-scoped table

Every step is required. The migration PR template should link this list.

1. **Model** inherits `TenantScopedModel` (which provides `tenant_id uuid
   NOT NULL` FK → `tenant`). No exceptions, including join tables
   (`user_role`) and child/line tables (`sales_invoice_item`): **child tables
   carry `tenant_id` too**, so RLS protects direct access to them and joins
   stay index-covered. *(Decision: the design sketches omit `tenant_id` on some
   child tables for brevity; §3.2's header — "every table has tenant_id, all
   RLS-protected" — governs.)*
2. **Migration** includes, in the same migration as the table:

   ```sql
   ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <table> FORCE  ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON <table>
     USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
     WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
   ```

3. **Indexes**: every composite index leads with `tenant_id`. Uniqueness that is
   "unique per shop" is `UNIQUE(tenant_id, ...)` — e.g. `(tenant_id, sku)`.
4. **Append-only tables** (audit-style): `REVOKE UPDATE, DELETE ON <table> FROM
   app_role;`
5. **Isolation test**: add the model to the parametrized list in
   `tests/test_tenant_isolation.py` (it should fail CI if you forget — the suite
   iterates every `TenantScopedModel` subclass).
6. **Factory**: register a factory hanging off `TenantFactory` so tests cannot
   create cross-tenant data by accident.
7. **Data migrations / backfills**: run as `migration_role`; document expected
   duration on the largest tenant; > 100k rows → Celery task, not a migration.

### Extending the tenant-isolation test suite

The suite (`backend/tests/test_tenant_isolation.py`) is parametrized over every
tenant-scoped model: for each, it creates rows for tenants A and B and asserts
that a request/connection authenticated as tenant A gets 404/empty querysets for
every one of B's rows — reads, writes, and direct PK access. When you add a
model, add it to the parametrization; when you add a new access pattern (raw
SQL, a new service connection, a Celery task path), add a case proving it
executes inside a tenant-scoped transaction. This suite runs in CI on every PR.
It lands **before** the first business feature, and it is the test that
protects the business.

---

## 9. Quick reference — what is forbidden

- Accepting tenant identity from any client-controlled input.
- Bare `SET app.tenant_id` (only `SET LOCAL` inside the request transaction).
- PgBouncer session pooling mode.
- Giving `app_role` superuser, table ownership, or `BYPASSRLS`.
- A tenant-scoped table without `ENABLE` + `FORCE` + policy in the same migration.
- Queries against platform tables from tenant request code.
- Cross-tenant "god mode" queries in the tenant app, even for support — support
  uses audited impersonation instead.
- Reusing a Celery task's DB connection across tenants without setting
  `app.tenant_id` per task transaction.
