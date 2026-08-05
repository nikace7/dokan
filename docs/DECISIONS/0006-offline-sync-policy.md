# 0006. Offline POS sync policy

**Status:** Accepted
**Date:** 2026-08-05

## Context

Phase 3 adds the offline-tolerant POS (SYSTEM_DESIGN §1.2, §11): load
shedding and ISP drops must not stop billing. The offline build (queued
operations in Dexie, a drain loop, a conflict policy — see
`frontend/src/lib/offline/README.md`) forces four policy questions before any
queue code lands:

1. **How do offline sales avoid duplicates when the device retries?**
   `POST /sales` already mandates an `Idempotency-Key` header with 200-replay
   (invariant 8) — the mechanism exists; the queue must use it correctly.
2. **Who assigns invoice numbers for offline sales?** Gapless per-branch
   per-fiscal-year numbering is an IRD invariant; the server assigns numbers
   from a row-locked `number_sequence` at write time.
3. **What happens when offline state disagrees with the server** (price
   changed, stock sold out, customer deactivated while the device was away)?
4. **How long does the queue retry a failing operation?**

The design's Phase 3 sketch mentioned "offline invoice numbering
(device-prefixed reservation blocks)" — this ADR resolves that open point.

## Decision

- **Queue locally, drain against the existing endpoint.** Offline sales are
  stored as pending operations in a Dexie table, each carrying a
  **client-generated `Idempotency-Key`** (a UUID minted when the cashier
  finalizes the bill offline, stored with the queued op, never regenerated).
  The drain loop replays each op against the existing idempotent
  `POST /sales`; a replay after an ambiguous failure returns the original
  invoice with 200, so retry is always safe.
- **Invoice numbers are assigned server-side at sync time.** The queued
  operation carries no invoice number; the server assigns one from the
  gapless per-branch-per-fiscal-year sequence when the op is applied. An
  offline sale has a local provisional reference for the cashier's screen and
  gets its real, gapless invoice number on sync.
- **Conflicts are server-wins, with a visible exception list.** Where
  server state has moved (price changed, stock sold out, customer or item
  deactivated), the server's state stands. Every such adjustment lands on a
  visible exception list in the UI — staff see what changed and why; nothing
  is silently rewritten.
- **4xx rejections permanently fail the queued op.** A validation or
  permission rejection will never succeed on retry, so the op is marked
  permanently failed and parked for staff review (fix the data, re-enter the
  bill if needed) instead of retried forever. Transient failures (network,
  5xx) retry with exponential backoff.

## Alternatives

- **Device-prefixed reservation blocks** (each device pre-allocates a block of
  invoice numbers, e.g. `INV-A-0001…`, while offline) — **rejected**. A device
  that never returns (lost, broken, replaced) leaves permanent gaps in the
  sequence, and gapless per-branch-per-fiscal-year numbering is an IRD
  invariant. Prefixes also leak device identity into the legal document
  number.
- **Last-writer-wins silent merge** — rejected; silent data changes at the
  counter are how shrinkage starts. Every conflict resolution must be visible.
- **Infinite retry on all failures** — rejected; a permanently failing op
  (e.g. price floor rejected) would block the drain loop and hide real
  problems in noise.
- **A separate `POST /sync/batch` endpoint accepting many ops per call** —
  deferred. The offline README sketches one, but per-op replay against the
  existing idempotent `POST /sales` needs no new server semantics; batching is
  a throughput optimization to revisit with load data, not a correctness
  requirement.

## Consequences

- No new server-side idempotency machinery: the existing
  `Idempotency-Key` contract (invariant 8) carries the whole retry story.
- Invoice numbers on a day's bills may be **out of wall-clock order** (a
  bill taken offline at 10:00 and synced at 14:00 gets a later number than
  bills taken online at 11:00). Gapless ordering is by number, not by time —
  this is consistent with IRD's requirement and must be explained in shop
  onboarding material.
- Stock taken offline can oversell: the server-wins conflict path plus the
  exception list is the mitigation; `tenant_setting.allow_negative_stock`
  governs whether the synced sale blocks or warns, exactly as it does online.
- Permanently failed ops need a staff-facing review screen — the exception
  list is a required part of the feature, not a nice-to-have.
- The queue must treat the idempotency key as immutable per operation;
  regenerating it on app restart would defeat duplicate protection.
