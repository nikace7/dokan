# Dokan load tests (k6)

k6 scripts for the two load targets in `AGENTS.md`:

| Script      | Endpoint                                | Target rate |
| ----------- | --------------------------------------- | ----------- |
| `sales.js`  | `POST /api/v1/sales` (completed CASH bill) | 50 rps      |
| `lookup.js` | `GET /api/v1/catalog/variants/lookup?sku=` | 200 rps     |

Both log in once in `setup()` against the demo tenant host
(`POST /api/v1/auth/token`, phone/password from `seed_demo`) and reuse the
JWT for every iteration. `sales.js` additionally resolves the default branch
and rate type, looks up the target variant, and opens a cash session if none
is open (invariant 12: POS completion requires one). Every sale iteration
sends a **unique `Idempotency-Key`** (invariant 8) — a 200 instead of 201
would mean an accidental replay.

Like `e2e/`, these are **not wired into CI** — they need the full local
compose stack plus seeded demo data.

## Prerequisites

1. Stack up and seeded:

   ```bash
   docker compose up -d --build
   docker compose exec backend python manage.py migrate
   docker compose exec backend python manage.py seed_demo
   ```

2. k6 installed (`winget install k6`, `choco install k6`, or see
   https://grafana.com/docs/k6/latest/set-up/install-k6/).

3. **For `sales.js` only — boost stock first.** Completed sales consume
   stock, and the seed loads just 20 units per variant; 50 rps exhausts that
   in the first second and the run fails on `STOCK_INSUFFICIENT`. Post a
   large opening-stock movement for the load SKU (default
   `TEE-01-M-BLACK`, seeded cost 600.00 — matching cost keeps the moving
   weighted average stable):

   ```bash
   docker compose exec backend python manage.py shell -c "
   from decimal import Decimal
   from django.db import connection, transaction
   from apps.tenants.models import Tenant, Branch
   from apps.accounts.models import User
   from apps.catalog.models import ItemVariant
   from apps.inventory.services import post_opening_stock
   from core.db.rls import set_local_tenant

   tenant = Tenant.objects.get(slug='demo')
   with transaction.atomic():
       set_local_tenant(connection, tenant.id)
       branch = Branch.objects.get(tenant=tenant, code='MAIN')
       owner = User.objects.get(tenant=tenant, phone='9800000000')
       variant = ItemVariant.objects.get(tenant=tenant, sku='TEE-01-M-BLACK')
       post_opening_stock(tenant, branch=branch, variant=variant,
                          qty=Decimal('100000'), unit_cost=Decimal('600.00'),
                          created_by=owner, note='Load test stock')
       print('stock boosted')
   "
   ```

   Also note the demo plan allows 10,000 invoices/month; each run consumes
   `rate × duration` of them (a default 1-minute run at 50 rps = 3,000 bills).

## Run

Windows resolves `*.localhost` to `::1`, where the Docker port proxy does not
listen — map the tenant host to IPv4 loopback with k6's `--hosts` flag:

```bash
k6 run --hosts demo.localhost=127.0.0.1 loadtests/sales.js
k6 run --hosts demo.localhost=127.0.0.1 loadtests/lookup.js
```

The local Caddy edge uses its internal CA; both scripts set
`insecureSkipTLSVerify: true` to match.

### Environment variables

| Var             | Default                  | Meaning                                  |
| --------------- | ------------------------ | ---------------------------------------- |
| `LOAD_BASE_URL` | `https://demo.localhost` | Tenant base URL (host = tenant).         |
| `LOAD_PHONE`    | `9800000000`             | Demo login.                              |
| `LOAD_PASSWORD` | `demo1234`               | Demo password.                           |
| `LOAD_SKU`      | `TEE-01-M-BLACK`         | Variant sold by `sales.js`.              |
| `LOAD_RPS`      | `50` / `200`             | Override the arrival rate per script.    |
| `LOAD_DURATION` | `1m`                     | Override the test duration.              |

## Thresholds

- `sales.js`: `p(95) < 800 ms`, error rate `< 1%` on the sale write path
  (row locks + gapless numbering make writes slower than reads by design).
- `lookup.js`: `p(95) < 200 ms`, error rate `< 1%` — the POS scan hot path
  must answer instantly.

## Baseline caveat

Absolute numbers are only meaningful against a recorded baseline on known
hardware. These thresholds were chosen for a single-VPS dev box running the
whole compose stack (Docker Desktop on Windows); a loaded CI runner or a
throttled laptop will skew them. Treat the first few runs on your machine as
the baseline, record them, and compare future runs against that — not against
another machine's numbers. Watch `shop_system-backend-1` and
`shop_system-db-1` CPU during runs; if the host is saturated, you are
measuring the laptop, not the app.
