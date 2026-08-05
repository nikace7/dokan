/**
 * Offline queue drain loop.
 *
 * Syncs queued sales one-by-one, in FIFO order, against the EXISTING
 * idempotent `POST /sales` — no sync endpoint needed: the op carries the
 * Idempotency-Key from its original attempt, so a retried drain is a
 * server-side 200-replay, never a duplicate bill.
 *
 * Failure policy:
 * - 4xx (insufficient stock, closed cash session, credit limit, …): the
 *   server gave a definitive answer — the op moves to `failed` and waits
 *   for a human in the exception list (conflicts.ts). It never retries.
 * - Network failure or 5xx: transient — attempts++, exponential backoff,
 *   and the drain stops until the retry timer or the `online` event.
 *
 * Status is exposed reactively via a small zustand store, matching the
 * app's state pattern.
 */

import { create } from 'zustand';

import { ApiError } from '@/lib/api/client';
import { authedRequest } from '@/lib/api/authed';
import { offlineDb } from '@/lib/offline/db';
import type { QueuedSaleOp } from '@/lib/offline/db';
import { countPendingOps, listFailedOps, listPendingOps } from '@/lib/offline/queue';

const MAX_BACKOFF_MS = 60_000;

/** Exponential backoff: 2s, 4s, 8s, … capped at 60s. */
export function backoffDelayMs(attempts: number): number {
  return Math.min(2 ** Math.max(1, attempts) * 1000, MAX_BACKOFF_MS);
}

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  failed: QueuedSaleOp[];
}

export const useSyncStore = create<SyncState>()(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pendingCount: 0,
  failed: [],
}));

/** Pull queue state into the store. Called after every mutation. */
export async function refreshSyncState(): Promise<void> {
  const [pendingCount, failed] = await Promise.all([countPendingOps(), listFailedOps()]);
  useSyncStore.setState({ pendingCount, failed });
}

/** POST one queued sale with its original Idempotency-Key. */
function postQueuedSale(op: QueuedSaleOp): Promise<unknown> {
  return authedRequest('/v1/sales', {
    method: 'POST',
    body: op.payload,
    idempotencyKey: op.idempotencyKey,
  });
}

let draining = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Cancel a scheduled retry (used by tests and teardown). */
export function cancelScheduledRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(attempts: number): void {
  cancelScheduledRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void drainQueue();
  }, backoffDelayMs(attempts));
}

/**
 * Drain the queue once: pending ops in FIFO order, stopping at the first
 * transient failure. Safe to call concurrently — a second call is a no-op.
 */
export async function drainQueue(): Promise<void> {
  if (draining) {
    return;
  }
  draining = true;
  useSyncStore.setState({ syncing: true });
  try {
    for (;;) {
      const [next] = await listPendingOps();
      if (!next || next.seq === undefined) {
        break;
      }
      try {
        await postQueuedSale(next);
        // Success (201) or idempotent replay (200): the bill exists
        // server-side exactly once — drop the local op.
        await offlineDb.saleOps.delete(next.seq);
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          // Definitive server rejection — park it for a human, keep draining.
          await offlineDb.saleOps.update(next.seq, {
            status: 'failed',
            lastError: err.message,
            failedAt: new Date().toISOString(),
          });
          continue;
        }
        // Transient (network down, 5xx): backoff and try again later.
        const attempts = next.attempts + 1;
        await offlineDb.saleOps.update(next.seq, {
          attempts,
          lastError: err instanceof Error ? err.message : 'Network error',
        });
        scheduleRetry(attempts);
        break;
      }
    }
  } finally {
    draining = false;
    useSyncStore.setState({ syncing: false });
    await refreshSyncState();
  }
}

let initialized = false;

/**
 * Wire the sync engine: drain on startup (when online) and whenever the
 * connection returns. Idempotent — safe under StrictMode double-mount.
 */
export function initOfflineSync(): void {
  if (initialized || typeof window === 'undefined') {
    return;
  }
  initialized = true;
  window.addEventListener('online', () => {
    useSyncStore.setState({ online: true });
    void drainQueue();
  });
  window.addEventListener('offline', () => {
    useSyncStore.setState({ online: false });
  });
  void refreshSyncState();
  if (navigator.onLine) {
    void drainQueue();
  }
}
