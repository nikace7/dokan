# `src/lib/offline` — offline-tolerant POS

Load shedding and ISP drops are real; billing must never stop. This module
is the Phase 3 offline POS (docs/SYSTEM_DESIGN.md §758). It is built
around one rule: **the server stays the only source of truth** — offline
work is queued locally and replayed against the existing idempotent
endpoints, never merged.

## What exists

- `db.ts` — the Dexie (IndexedDB) database: `saleOps` (pending/failed
  sales, FIFO by auto-increment `seq`, unique `idempotencyKey`) and
  `variantCache` (lookup rows for offline barcode/SKU lookup).
- `queue.ts` — enqueue a sale when `POST /sales` fails at the network
  layer. The Idempotency-Key is chosen at enqueue time and never changes,
  so every retry replays server-side (200-replay) instead of duplicating.
  Each op gets a provisional `OFF-XXXXXXXX` local reference for the
  offline receipt — invoice numbers are assigned at sync time, server-side
  (gapless IRD numbering is never faked locally).
- `sync.ts` — the drain loop. One-by-one, in FIFO order, against the
  existing `POST /sales` (no sync endpoint). A 4xx moves the op to
  `failed` permanently (the server gave a definitive answer); a network
  error or 5xx increments attempts and retries with exponential backoff
  (2s → 60s cap), plus an immediate drain on the `online` event.
  `useSyncStore` exposes `{ online, syncing, pendingCount, failed }`
  reactively. `initOfflineSync()` boots from `App` on tenant hosts.
- `conflicts.ts` — server-wins policy. Failed ops surface in the billing
  screen's exception list (`SyncStatusBanner`) where staff can inspect the
  bill and discard it; discard only deletes the local op (the sale never
  happened server-side). There is no auto-merge.
- `catalogCache.ts` — read-through cache for `lookupVariant`: every
  successful online lookup is cached; a network failure falls back to the
  cache (barcode, then SKU). Stale cached prices are harmless — prices at
  the counter are display-only and the server is authoritative at sale
  time.

## Billing integration

`BillingPage` enqueues only on a genuine network failure
(`isNetworkError` in `lib/api/client.ts` — fetch's TypeError). A 4xx keeps
the existing verbatim-error path and never queues. Held-bill completion
needs a server id and stays online-only. The queued-bill receipt shows the
provisional `OFF-` reference and explains the invoice number arrives at
sync time.

## Service worker

`public/sw.js` is a hand-rolled app-shell SW (precache shell, network-first
navigations, cache-first hashed assets), registered in `main.tsx` in
production only. It never intercepts `/api` — offline API reads come from
the Dexie cache, and POSTs are never cached.

## Deliberately not built (yet)

- Device-prefixed offline invoice-number reservation blocks (design
  §1137) — the provisional reference covers the demo scope.
- Offline held bills, returns, and payments — sales only.
- Background Sync API (`sync` event) — the `online` event + retry timers
  cover it without the browser-support caveats.
