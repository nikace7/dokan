# `src/lib/offline` — offline POS (Phase 3, not built yet)

The offline-tolerant POS (PWA with a Dexie-backed operation queue, sync
engine via `POST /sync/batch`, and a conflict policy) is **Phase 3**
(docs/SYSTEM_DESIGN.md §1.2). Load shedding and ISP drops are real, but the
offline queue is useless before the billing screen exists.

What lands here in Phase 3:

- `queue.ts` — Dexie table of pending, idempotency-keyed operations.
- `sync.ts` — drain loop against `POST /sync/batch`, exponential backoff.
- `conflicts.ts` — server-wins policy with a visible exception list.
- Service worker registration (the `public/manifest.webmanifest` placeholder
  already exists; no SW is registered in Phase 1).

Until then: do not add a service worker or local persistence for sales —
a half-built offline queue is worse than none.
