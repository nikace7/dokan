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

## Screens

The demo workflow covers the full loop in the browser:

- `/catalog` — items list (search, category/status filters) with create/edit
  forms and inline quick-add for categories, brands, and size charts. Item
  detail hosts the size × colour matrix entry (one bulk POST for the whole
  grid) and the variant table.
- `/stock` — the stock-level projection (read-only by design) plus the
  "Add opening stock" dialog. The avg-cost column appears only for users
  whose backend permissions expose it.
- `/purchasing` — suppliers and purchase invoices: save a DRAFT, then
  Confirm (guarded, irreversible) to post stock and update cost.
- `/expenses` — record tenant-wide expenses, add categories, filter by BS
  period/category, and view category totals.
- `/payments` — record customer khata receipts and review payment history.
- `/returns` — select completed bills, record return quantities, and issue return documents.
- `/audit` — owner-only read-only audit trail with action/date filters and before/after diffs.
- `/billing` — the POS screen.
- `/reports` — the owner's reports: sales (daily by BS date with totals,
  monthly by fiscal year, top items), stock (summary/low/dead), profit
  (owner-only; a friendly panel on 403), dues (udharo aging buckets +
  supplier payables), and the IRD VAT registers (sales/purchase). Report
  date ranges are BS strings and default to the current BS month via
  `lib/bs`.

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
- Paginated list endpoints return envelope `meta` (count/page/total_pages)
  via `apiRequestPage` / `authedRequestPage`; single-resource calls use
  `apiRequest` / `authedRequest`.
- Cost fields (`avg_cost`, `unit_cost`) render only when the backend
  includes them in the response (`pricing.view_cost`) — UI checks presence,
  never permission guesses.
- `POST /sales` (and hold/complete) send one `Idempotency-Key` per bill
  attempt — never regenerated on retry of the same attempt.
