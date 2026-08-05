# Dokan E2E tests (Playwright)

End-to-end smoke suite for the tenant frontend, per the testing strategy in
`AGENTS.md`: **login → billing loads**, **scan → cart → cash bill → receipt**,
and a **return against the created bill**. It runs against the real local
stack — it is deliberately **not wired into CI**: the suite needs the full
compose stack (Postgres, Redis, backend, frontend, Caddy) plus seeded demo
data, which is too heavy for the PR gate. Run it locally before releases or
after touching `frontend/src/features/billing|auth|returns`.

## Prerequisites

1. The local stack is up and seeded:

   ```bash
   # from the repo root
   docker compose up -d --build
   docker compose exec backend python manage.py migrate
   docker compose exec backend python manage.py seed_demo
   ```

2. Install the suite's own toolchain (kept out of `frontend/` on purpose):

   ```bash
   cd e2e
   npm ci          # or: npm install
   npx playwright install chromium
   ```

## Run

```bash
cd e2e
npx playwright test            # headless, single worker
npx playwright test --headed   # watch it
npx playwright test --list     # discover tests without running
npm run typecheck              # tsc --noEmit
```

Default target is the compose edge: `https://demo.localhost` (Caddy, internal
CA — `ignoreHTTPSErrors` is set). Two environment notes:

- **Windows resolves `*.localhost` to `::1`**, where the Docker port proxy
  does not listen. The Playwright config therefore forces the tenant host
  onto `127.0.0.1` via `--host-resolver-rules`. If you run on a setup where
  the tenant host needs no mapping, this is harmless.
- The demo tenant comes from the **subdomain only** (invariant 4). Setup API
  calls bypass Caddy and hit the backend's direct port with an explicit
  `Host` header.

### Environment variables

| Var              | Default                     | Meaning                                             |
| ---------------- | --------------------------- | --------------------------------------------------- |
| `E2E_BASE_URL`   | `https://demo.localhost`    | What the browser loads.                             |
| `E2E_API_URL`    | `http://127.0.0.1:8000`     | Backend origin used by setup/teardown helpers.      |
| `E2E_TENANT_HOST`| `demo.localhost`            | Host header/SNI the tenant is resolved from.        |
| `E2E_PHONE`      | `9800000000`                | Demo login (from `seed_demo`).                      |
| `E2E_PASSWORD`   | `demo1234`                  | Demo password.                                      |

### Vite dev server alternative

```bash
cd ../frontend && npm run dev        # serves http://localhost:5173, proxies /api
cd ../e2e
E2E_BASE_URL=http://localhost:5173 npx playwright test
```

The Vite proxy already rewrites the API `Host` header to the demo tenant (see
`frontend/vite.config.ts`); the backend from the compose stack (or a local
`manage.py runserver` on port 8000) must still be running and seeded.

## Troubleshooting

- **The receipt step crashes with "Cannot read properties of undefined
  (reading 'map')"**: the running containers are older than the source. The
  current `ReceiptPanel` reads `invoice.tenders` / `tenant_name`, which only
  exist in the invoice detail since the receipt-printing merge; an older
  backend build omits them. Rebuild the stack from current source
  (`docker compose up -d --build backend frontend`) and re-run.
- **Login times out / page never loads**: check the tenant host resolves to
  the stack. The config maps the tenant host to `127.0.0.1` for Chromium
  already; if you overrode `E2E_BASE_URL` with a real hostname, add a hosts
  entry or use `--host-resolver-rules`-compatible DNS.
- **`IDEMPOTENCY_KEY_REQUIRED` / 4xx from setup helpers**: the backend on
  `E2E_API_URL` is not the seeded one, or `E2E_TENANT_HOST` points at the
  wrong tenant.

## What the tests do to the data

The suite writes to the demo tenant: it opens a cash session if none is open
(invariant 12 — POS completion requires one), completes real cash bills, and
records a return. Each run consumes a couple of units of demo stock. If stock
runs out, re-run `seed_demo` does **not** top it up — post new opening stock
from the inventory screen, or reset the database volume.

## Layout

- `playwright.config.ts` / `config.ts` — target environment and browser flags.
- `fixtures.ts` — API login + localStorage token seeding (keys match
  `frontend/src/lib/auth/tokens.ts`).
- `helpers/api.ts` — setup calls (branch, rate type, variant lookup, cash
  session, sale creation) against the tenant API.
- `pages/` — Page Object Model for login, billing, returns. Locators use
  labels/roles/text from the real UI; no `data-testid` was needed.
- `tests/` — `login.spec.ts`, `billing.spec.ts`, `return.spec.ts`.
