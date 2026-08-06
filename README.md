# Dokan — Clothing Shop Management System

Multi-tenant SaaS for clothing retail shops in Nepal: subdomain-per-shop
(`<slug>.dokan.com.np`), Nepali (BS) calendar native, IRD-compliant billing,
and an offline-tolerant POS. The authoritative specification is
[`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md); house rules for
contributors (human or AI) are in [`AGENTS.md`](AGENTS.md).

## Stack

- **Backend:** Django 5 + DRF + SimpleJWT, PostgreSQL 16 (Row-Level Security
  for tenant isolation), Redis, Celery.
- **Frontend:** Vite + React + TypeScript tenant/admin SPA, built into an
  unprivileged production image.
- **Deploy (Phase 1):** single VPS, Docker Compose, Caddy with wildcard TLS.

## Quickstart (backend)

Prerequisites: Docker + Docker Compose, or Python 3.12 for a local venv.

```bash
cp .env.example .env          # fill in the change-me values
docker compose up --build     # db, redis, backend, frontend, celery, beat, caddy
# Migrations use the dedicated role; demo bootstrap uses the local superuser.
docker compose exec backend sh -c 'DATABASE_USER=dokan_migrator DATABASE_PASSWORD="$DOKAN_MIGRATOR_PASSWORD" python manage.py migrate'
docker compose exec backend sh -c 'DATABASE_USER=postgres DATABASE_PASSWORD="$POSTGRES_PASSWORD" python manage.py seed_demo'
```

Local development without Docker:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e "backend[dev]"
cd backend
python manage.py migrate
python manage.py runserver
```

### Try the demo shop (end-to-end)

With Postgres running (any local instance; below uses port 5433 as an
example) and from `backend/`:

```bash
export ROOT_DOMAIN=localhost           # tenants resolve as <slug>.localhost
export DATABASE_PORT=5433 DATABASE_USER=postgres DATABASE_PASSWORD=testpw DATABASE_NAME=dokan_dev
export DJANGO_SETTINGS_MODULE=config.settings.dev

python manage.py migrate
python manage.py seed_demo             # idempotent demo tenant + owner + catalog + stock
python manage.py runserver
```

Then open **http://demo.localhost:8000/api/docs/** (browsers resolve
`*.localhost` to loopback; if Windows tries IPv6 `::1` first and fails, apply
the `hosts`-file pin described in "Run locally (full Docker stack)" below) and log in via
`POST /api/v1/auth/token` with phone `9800000000`, password `demo1234`.
Every tenant endpoint must be called on the `demo.localhost` host — the
tenant comes from the subdomain, never from a header. `seed_demo` creates
a branch, an owner with all permissions, a default Retail rate type, three
items with M/L variants, and 20 units of opening stock per variant, so
`POST /api/v1/sales` works after opening the branch's cash session (remember
the mandatory `Idempotency-Key` header).

For hot-reload development, the frontend (`frontend/`) serves login and the POS billing screen:
`npm install && npm run dev` proxies `/api` to IPv4 loopback while preserving
`demo.localhost` as the tenant host. After sign-in, choose the active branch
and rate type in the app header. Sign in at http://localhost:5173 with the
seeded owner above. On a ready bill, F9 completes the sale and opens the
bilingual 80mm receipt; reprints are recorded as immutable audit events.

The same build serves the isolated platform control plane on
http://admin.localhost:5173. Set `PLATFORM_ADMIN_ALLOWED_IPS` for the client
network, provision an account with `python manage.py create_platform_user
--email admin@example.com --full-name "Platform Admin"`, and enroll the
one-time TOTP secret printed by that command. Platform and tenant tokens use
separate storage, and tenant support sessions are handed off through a
short-lived URL fragment that is cleared immediately after use.

The Compose stack builds the same frontend for production and serves tenant and
admin routes through Caddy; `/api` remains same-origin and is forwarded to
Django with the original Host intact. Local Caddy uses its internal certificate
authority, while production uses the Cloudflare DNS-01 snippet documented in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
After seeding, open `https://demo.localhost`; the first local visit may require
accepting Caddy's development certificate.

Local SMS uses the no-network `log` provider: receipt requests are queued and
delivery state is persisted without sending real messages. Use
`POST /api/v1/notifications/sms/receipt`; owners can inspect status at
`GET /api/v1/notifications/sms`. A real provider adapter is required before
enabling SMS in production.

## Run locally (full Docker stack)

This is the production-like local setup — one command, no local Python/Node
needed:

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

| URL | What | Login |
|---|---|---|
| `https://demo.localhost` | Tenant app (demo shop) | phone `9800000000`, password `demo1234` |
| `https://admin.localhost` | Platform control plane | create with `python manage.py create_platform_user …`, TOTP required |

Two platform gotchas:

- **Windows `hosts` pin.** Browsers resolve `*.localhost` to loopback, but
  Windows may try IPv6 `::1` first, where nothing (or the wrong Windows
  service) answers. Force IPv4 by adding this line to
  `C:\Windows\System32\drivers\etc\hosts` (edit as Administrator):
  `127.0.0.1 demo.localhost admin.localhost app.localhost www.localhost`
  (one line, space-separated), then `ipconfig /flushdns`.
- **Certificate warning.** Local Caddy issues certs from its own dev CA. Either
  accept the browser warning once, or trust it permanently:
  `docker cp shop_system-caddy-1:/data/caddy/pki/authorities/local/root.crt .`
  then import `root.crt` into the OS Trusted Root store.

The `frontend` container intentionally publishes **no host port** (`docker ps`
shows bare `8080/tcp`): all public traffic enters through Caddy, which forwards
`/api` to Django with the original `Host` intact. For hot-reload frontend
development instead, run `npm install && npm run dev` in `frontend/` and use
http://localhost:5173 (Vite proxies `/api` to the backend).


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
├── apps/              # one Django app per business module (skeletons)
├── tests/factories/   # TenantFactory — every factory hangs off it
└── scripts/           # e.g. golden-fixture generator
docs/                  # SYSTEM_DESIGN.md (authoritative) + planned docs
frontend/              # React PWA (separate scaffold)
docker/postgres/init/  # app/migration role bootstrap
.github/workflows/     # CI gates: ruff, mypy, pytest+coverage, frontend tests,
                       # build, migrations, gitleaks
```

## Documentation

Start with `docs/SYSTEM_DESIGN.md` and `AGENTS.md`. The design lists the
full doc set (ARCHITECTURE, MULTI_TENANCY, DATABASE_SCHEMA, RATE_RULES,
GIT_WORKFLOW, ROADMAP, …) in `docs/` — they land alongside the code they
describe, per the repo rule that stale docs are deleted, not kept.
