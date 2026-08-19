# mero-pasal.online — Clothing Shop Management System

Multi-tenant SaaS for clothing retail shops in Nepal: one subdomain per shop
(`<slug>.mero-pasal.online`), Nepali (BS) calendar native, IRD-compliant billing,
and an offline-tolerant POS that runs as a PWA on any phone or laptop.

## Features

- **Simple Sale** — a mobile-first counter flow: pick an item, pick a size,
  see the allowed selling-price range, enter the sold price, tender Cash/QR,
  and share the bill with the customer as a link. A classic barcode POS is
  available as a per-tenant plan feature.
- **Inventory** — immutable stock ledger: opening stock, signed adjustments,
  damage write-offs, branch-to-branch transfers, and physical counts with
  variance finalization.
- **Udharo (khata)** — customer credit with limits, receipt allocation,
  linked reversals, and receivables aging; supplier ledgers and cash
  day-close sessions.
- **Reports** — daily/monthly/top-item sales, stock summary/low/dead, profit,
  dues, and IRD VAT registers — all native to the BS fiscal calendar.
- **Platform control plane** — provision tenants, manage plans and custom
  subscriptions, toggle per-tenant features, inspect usage, and open
  time-boxed, fully audited support sessions into any tenant.
- **Bilingual UI** — English/नेपाली toggle across the tenant app.

## Stack

- **Backend:** Django 5 + DRF + SimpleJWT, PostgreSQL 16 (Row-Level Security
  for tenant isolation), Redis, Celery.
- **Frontend:** Vite + React + TypeScript tenant/admin SPA, Tailwind,
  TanStack Query, Zustand; built into an unprivileged production image.
- **Deploy:** single VPS, Docker Compose, Caddy with wildcard TLS.

## Quickstart (Docker)

Prerequisites: Docker + Docker Compose.

```bash
cp .env.example .env          # fill in the change-me values
docker compose up --build -d  # db, redis, backend, frontend, celery, beat, caddy

# Apply migrations as the dedicated migrator role (NOT the superuser —
# superuser-created tables miss the GRANTs the app role needs):
docker compose exec backend sh -c 'DATABASE_USER=dokan_migrator DATABASE_PASSWORD="$DOKAN_MIGRATOR_PASSWORD" python manage.py migrate'

# Seed the demo shop (idempotent):
docker compose exec backend sh -c 'DATABASE_USER=postgres DATABASE_PASSWORD="$POSTGRES_PASSWORD" python manage.py seed_demo'
```

Then open:

| URL                     | What                        | Login                                                                       |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `https://demo.localhost`  | Tenant app (demo shop)      | phone `9800000000`, password `demo1234`                                     |
| `https://admin.localhost` | Platform control plane      | create with `python manage.py create_platform_user …`, TOTP required        |

Two platform gotchas:

- **Windows `hosts` pin.** Browsers resolve `*.localhost` to loopback, but
  Windows may try IPv6 `::1` first, where nothing (or the wrong Windows
  service) answers. Force IPv4 by adding this line to
  `C:\Windows\System32\drivers\etc\hosts` (edit as Administrator):
  `127.0.0.1 demo.localhost admin.localhost app.localhost www.localhost`
  (one line, space-separated), then `ipconfig /flushdns`.
- **Certificate warning.** Local Caddy issues certs from its own dev CA.
  Either accept the browser warning once, or trust it permanently:
  `docker cp shop_system-caddy-1:/data/caddy/pki/authorities/local/root.crt .`
  then import `root.crt` into the OS Trusted Root store.

The `frontend` container intentionally publishes **no host port** (`docker ps`
shows bare `8080/tcp`): all public traffic enters through Caddy, which forwards
`/api` to Django with the original `Host` intact.

The demo seed creates a branch, an owner with all permissions, a default
Retail rate type, three items with M/L variants, and 20 units of opening stock
per variant. Open the branch cash session from `/payments`, then bill from the
simple-sale screen. The tenant comes from the subdomain, never from a header —
every tenant endpoint must be called on the `demo.localhost` host.

The same build serves the isolated platform control plane on
`https://admin.localhost`. Set `PLATFORM_ADMIN_ALLOWED_IPS` for the client
network, provision an account with
`python manage.py create_platform_user --email admin@example.com --full-name "Platform Admin"`,
and enroll the one-time TOTP secret printed by that command. Platform and
tenant tokens use separate storage, and tenant support sessions are handed off
through a short-lived URL fragment that is cleared immediately after use.

Local SMS uses the no-network `log` provider: receipt requests are queued and
delivery state is persisted without sending real messages. A real provider
adapter is required before enabling SMS in production.

## Local development (hot reload)

Backend (Python 3.12):

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e "backend[dev]"
cd backend
python manage.py migrate
python manage.py runserver
```

Frontend (Node 20+):

```bash
cd frontend
npm install && npm run dev
```

Vite serves http://localhost:5173 and proxies `/api` to IPv4 loopback while
preserving `demo.localhost` as the tenant host. Sign in with the seeded owner;
choose the active branch and rate type in the app header.

Useful commands (from `backend/`):

```bash
ruff check . && ruff format --check .   # lint + format gate
mypy .                                  # type gate
pytest --cov                            # tests (coverage floor 80%)
python scripts/generate_bs_golden.py    # regenerate the AD↔BS golden fixture
python manage.py export_tenant demo --output demo-export.zip
```

Production database recovery runs under the Compose `production` profile:
verified nightly logical dumps, weekly physical base backups, and continuous
WAL upload to S3-compatible storage. Run the guarded monthly check with
`docker compose --profile ops run --rm restore-drill`; see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) before operating production.

## Repository layout

```
backend/
├── config/            # settings split (base/dev/prod/test), urls, celery
├── core/              # platform spine: BS calendar, money, RLS, tenant
│                      # middleware, numbering, permissions, base models
├── apps/              # one Django app per business module (15 apps)
├── tests/factories/   # TenantFactory — every factory hangs off it
└── scripts/           # e.g. golden-fixture generator
docs/                  # architecture, tenancy, schema, deployment, ADRs, …
frontend/              # React PWA (tenant app + platform control plane)
e2e/                   # Playwright smoke suite (local, not in CI)
loadtests/             # k6 load scripts for the POS hot paths
docker/postgres/init/  # app/migration role bootstrap
.github/workflows/     # CI gates: ruff, mypy, pytest+coverage, frontend tests,
                       # build, migrations, gitleaks
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, layering
  rules, and the twelve data/consistency invariants
- [`docs/MULTI_TENANCY.md`](docs/MULTI_TENANCY.md) — subdomain tenancy and the
  Postgres RLS model
- [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) — tables, constraints,
  and indexing rules
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — VPS layout, TLS, backups,
  restore drill
- [`docs/RATE_RULES.md`](docs/RATE_RULES.md) — rate types and price resolution
- [`docs/NEPALI_LOCALIZATION.md`](docs/NEPALI_LOCALIZATION.md) — BS calendar
  and NPR formatting conventions
- [`docs/COMPLIANCE_IRD.md`](docs/COMPLIANCE_IRD.md) — billing compliance and
  the CBMS sync queue
- [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) — the full design
  specification
- [`docs/DECISIONS/`](docs/DECISIONS/) — architecture decision records
- [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md) ·
  [`docs/ROADMAP.md`](docs/ROADMAP.md) · [`CHANGELOG.md`](CHANGELOG.md)
