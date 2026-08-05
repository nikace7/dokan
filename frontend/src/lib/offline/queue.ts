/**
 * The offline sale queue.
 *
 * A sale is enqueued only when `POST /sales` fails at the network layer
 * (never for a 4xx — those are real rejections the cashier must fix). The
 * Idempotency-Key is chosen at enqueue time and never changes afterwards,
 * so every retry — the drain loop, a page reload, a double-tap — replays
 * against the server's 200-replay instead of risking a duplicate bill.
 */

import { offlineDb } from '@/lib/offline/db';
import type { QueuedSaleOp } from '@/lib/offline/db';
import type { CreateSalePayload } from '@/features/billing/api';

/** Provisional local reference for the offline receipt (not an invoice no). */
export function localRefFor(idempotencyKey: string): string {
  return `OFF-${idempotencyKey.slice(0, 8).toUpperCase()}`;
}

/**
 * Enqueue a sale for later sync. Dedupes on the Idempotency-Key: enqueuing
 * the same attempt twice returns the existing op unchanged.
 */
export async function enqueueSale(
  payload: CreateSalePayload,
  idempotencyKey: string,
): Promise<QueuedSaleOp> {
  const existing = await offlineDb.saleOps.where('idempotencyKey').equals(idempotencyKey).first();
  if (existing) {
    return existing;
  }
  const op: QueuedSaleOp = {
    idempotencyKey,
    localRef: localRefFor(idempotencyKey),
    payload,
    attempts: 0,
    lastError: null,
    status: 'pending',
    enqueuedAt: new Date().toISOString(),
    failedAt: null,
  };
  const seq = await offlineDb.saleOps.add(op);
  return { ...op, seq };
}

/** Pending ops in drain order (FIFO by enqueue sequence). */
export function listPendingOps(): Promise<QueuedSaleOp[]> {
  return offlineDb.saleOps.where('status').equals('pending').sortBy('seq');
}

/** Permanently failed ops (server said no) — the conflict exception list. */
export function listFailedOps(): Promise<QueuedSaleOp[]> {
  return offlineDb.saleOps.where('status').equals('failed').sortBy('seq');
}

export async function countPendingOps(): Promise<number> {
  return offlineDb.saleOps.where('status').equals('pending').count();
}
