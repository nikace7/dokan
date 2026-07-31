# Dokan — Clothing Shop Management System

Multi-tenant SaaS for clothing retail shops in Nepal: subdomain-per-shop
(`<slug>.dokan.com.np`), Nepali (BS) calendar native, IRD-compliant billing,
and an offline-tolerant POS. The authoritative specification is
[`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md); house rules for
contributors (human or AI) are in [`AGENTS.md`](AGENTS.md).

## Stack

- **Backend:** Django 5 + DRF + SimpleJWT, PostgreSQL 16 (Row-Level Security
  for tenant isolation), Redis, Celery.
- **Frontend:** Vite + React + TypeScript PWA (lands separately — see
  `frontend/`).
- **Deploy (Phase 1):** single VPS, Docker Compose, Caddy with wildcard TLS.

## Quickstart (backend)

Prerequisites: Docker + Docker Compose, or Python 3.12 for a local venv.

```bash
cp .env.example .env          # fill in the change-me values
docker compose up --build     # db, redis, backend, celery, beat, caddy
docker compose exec backend python manage.py migrate
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
`*.localhost` to loopback — no hosts-file edits) and log in via
`POST /api/v1/auth/token` with phone `9800000000`, password `demo1234`.
Every tenant endpoint must be called on the `demo.localhost` host — the
tenant comes from the subdomain, never from a header. `seed_demo` creates
a branch, an owner with all permissions, a default Retail rate type, three
items with M/L variants, and 20 units of opening stock per variant, so
`POST /api/v1/sales` works out of the box (remember the mandatory
`Idempotency-Key` header).

The frontend (`frontend/`) serves login and the POS billing screen:
`npm install && npm run dev` proxies `/api` to `demo.localhost:8000` (the
tenant host) — see `frontend/README.md` for the two `VITE_DEMO_*` env vars
the billing screen needs until branch/rate-type list endpoints exist. Sign
in at http://localhost:5173 with the seeded owner above.

Useful commands (from `backend/`):

```bash
ruff check . && ruff format --check .   # lint + format gate
mypy .                                  # type gate
pytest --cov                            # tests (coverage floor 80%)
python scripts/generate_bs_golden.py    # regenerate the AD↔BS golden fixture
```

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
.github/workflows/     # CI gates: ruff, mypy, pytest+coverage, migrations,
                       # gitleaks
```

## Documentation

Start with `docs/SYSTEM_DESIGN.md` and `AGENTS.md`. The design lists the
full doc set (ARCHITECTURE, MULTI_TENANCY, DATABASE_SCHEMA, RATE_RULES,
GIT_WORKFLOW, ROADMAP, …) in `docs/` — they land alongside the code they
describe, per the repo rule that stale docs are deleted, not kept.
