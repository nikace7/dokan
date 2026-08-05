/**
 * Conflict policy: server wins, humans decide.
 *
 * A queued sale only reaches `failed` when the server gave a definitive
 * 4xx answer (insufficient stock by sync time, closed cash session, plan
 * limit, …). There is nothing to merge — the sale never happened
 * server-side — so the policy is: show the bill in a visible exception
 * list, let staff inspect it, and discard it locally (or re-ring it at the
 * counter as a fresh sale). No auto-merge, no silent drops.
 */

import { offlineDb } from '@/lib/offline/db';
import type { QueuedSaleOp } from '@/lib/offline/db';
import { listFailedOps } from '@/lib/offline/queue';
import { refreshSyncState } from '@/lib/offline/sync';

/** The exception list — failed ops in enqueue order. */
export function listExceptions(): Promise<QueuedSaleOp[]> {
  return listFailedOps();
}

/**
 * Discard a failed op. This is the ONLY resolution: the server never
 * recorded the sale, so deleting the local op simply abandons the bill.
 */
export async function discardException(seq: number): Promise<void> {
  await offlineDb.saleOps.delete(seq);
  await refreshSyncState();
}

/** One-line summary for the exception list, e.g. "3 lines". */
export function summarizeOp(op: QueuedSaleOp): string {
  const lines = op.payload.lines.length;
  return `${lines} line${lines === 1 ? '' : 's'}`;
}
