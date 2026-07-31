# Dokan frontend

Vite + React + TypeScript for the multi-tenant clothing-shop SaaS. See the
root `AGENTS.md` and `docs/SYSTEM_DESIGN.md` for the architecture; this
file is the quickstart.

## Quickstart (demo tenant)

1. Start the backend per the root README (`migrate` + `seed_demo` +
   `runserver`) so the demo shop answers on **http://demo.localhost:8000**.
   The tenant comes from the request **host**, never from a header or
   parameter — which is why the Vite dev proxy in `vite.config.ts` forwards
   `/api` to `http://demo.localhost:8000`, not plain `localhost:8000`
   (browsers resolve `*.localhost` to loopback; no hosts-file edits).
2. `cp .env.example .env` and fill in `VITE_DEMO_BRANCH_ID` /
   `VITE_DEMO_RATE_TYPE_ID` with the seeded demo branch and default rate
   type UUIDs. There is no branch/rate-type list endpoint yet (see the TODO
   in `src/lib/config.ts`); find the IDs via the demo DB or a recent
   invoice from `GET /api/v1/sales`.
3. `npm install && npm run dev`, open http://localhost:5173, and sign in
   with the seeded owner: phone `9800000000`, password `demo1234`.
4. `/billing` is the POS screen: scan a barcode (or type a SKU), tender,
   complete. Parked bills resume from the "Held bills" list.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server with the tenant-aware `/api` proxy |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit/component tests |
| `npm run build` | Type check + production build |
| `npm run api:gen` | Regenerate the typed API client from the backend OpenAPI schema |

## Conventions

- All money is integer paisa client-side (`src/lib/money.ts`); the API
  exchanges decimal strings. Never float arithmetic on money.
- BS date handling lives only in `src/lib/bs/`; the API always exchanges
  AD ISO strings.
- Cart/UI state → Zustand (`src/stores/cartStore.ts`); server state →
  TanStack Query. The server is authoritative for every price and total.
- `POST /sales` (and hold/complete) send one `Idempotency-Key` per bill
  attempt — never regenerated on retry of the same attempt.
