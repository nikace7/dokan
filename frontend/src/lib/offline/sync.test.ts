import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearTokens, setTokens } from '@/lib/auth/tokens';
import { offlineDb } from '@/lib/offline/db';
import type { QueuedSaleOp } from '@/lib/offline/db';
import { enqueueSale, listPendingOps } from '@/lib/offline/queue';
import {
  backoffDelayMs,
  cancelScheduledRetry,
  drainQueue,
  refreshSyncState,
  useSyncStore,
} from '@/lib/offline/sync';
import type { CreateSalePayload } from '@/features/billing/api';

const fetchMock = vi.fn<typeof fetch>();

const PAYLOAD: CreateSalePayload = {
  branch: 'branch-1',
  rate_type: 'rate-1',
  lines: [{ variant: 'var-1', qty: '1', discount: '0.00' }],
  payments: [{ method: 'CASH', amount: '1500.00' }],
  is_vat_bill: false,
};

function okEnvelope(status = 201): Response {
  return new Response(JSON.stringify({ data: { id: 'sale-1' }, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorEnvelope(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ data: null, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sentKey(call: [input: RequestInfo | URL, init?: RequestInit]): string | null {
  return (call[1]?.headers as Headers).get('Idempotency-Key');
}

describe('offline sync drain', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    await offlineDb.saleOps.clear();
  });

  afterEach(async () => {
    cancelScheduledRetry();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    await offlineDb.saleOps.clear();
  });

  it('drains pending ops in FIFO order with their original Idempotency-Keys', async () => {
    const key1 = crypto.randomUUID();
    const key2 = crypto.randomUUID();
    await enqueueSale(PAYLOAD, key1);
    await enqueueSale(PAYLOAD, key2);
    fetchMock.mockResolvedValue(okEnvelope());

    await drainQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/sales');
    expect(sentKey(fetchMock.mock.calls[0])).toBe(key1);
    expect(sentKey(fetchMock.mock.calls[1])).toBe(key2);
    expect(await listPendingOps()).toHaveLength(0);
    expect(useSyncStore.getState().pendingCount).toBe(0);
  });

  it('moves a 4xx rejection to failed with the server message and keeps draining', async () => {
    const badKey = crypto.randomUUID();
    const goodKey = crypto.randomUUID();
    await enqueueSale(PAYLOAD, badKey);
    await enqueueSale(PAYLOAD, goodKey);
    fetchMock
      .mockResolvedValueOnce(errorEnvelope(409, 'STOCK_INSUFFICIENT', 'Insufficient stock.'))
      .mockResolvedValueOnce(okEnvelope());

    await drainQueue();

    const state = useSyncStore.getState();
    expect(state.failed).toHaveLength(1);
    expect(state.failed[0].idempotencyKey).toBe(badKey);
    expect(state.failed[0].lastError).toBe('Insufficient stock.');
    expect(state.failed[0].status).toBe('failed');
    // The next op still drained — one bad bill never blocks the queue.
    expect(state.pendingCount).toBe(0);
    expect(await offlineDb.saleOps.count()).toBe(1);
  });

  it('keeps the op pending with attempts+1 on network failure and backs off', async () => {
    await enqueueSale(PAYLOAD, crypto.randomUUID());
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await drainQueue();

    const [op] = await listPendingOps();
    expect(op.status).toBe('pending');
    expect(op.attempts).toBe(1);
    expect(op.lastError).toBe('Failed to fetch');
    expect(useSyncStore.getState().syncing).toBe(false);
    // Nothing was posted successfully — the op is still the only row.
    expect(await offlineDb.saleOps.count()).toBe(1);
  });

  it('treats 5xx as transient (stays pending), not a permanent failure', async () => {
    await enqueueSale(PAYLOAD, crypto.randomUUID());
    fetchMock.mockResolvedValue(errorEnvelope(502, 'BAD_GATEWAY', 'Bad gateway'));

    await drainQueue();

    const [op] = await listPendingOps();
    expect(op.status).toBe('pending');
    expect(op.attempts).toBe(1);
    expect(useSyncStore.getState().failed).toHaveLength(0);
  });

  it('backs off exponentially with a 60s cap', () => {
    expect(backoffDelayMs(1)).toBe(2_000);
    expect(backoffDelayMs(2)).toBe(4_000);
    expect(backoffDelayMs(3)).toBe(8_000);
    expect(backoffDelayMs(10)).toBe(60_000);
  });

  it('does not double-drain when called concurrently', async () => {
    await enqueueSale(PAYLOAD, crypto.randomUUID());
    let resolveFetch: ((r: Response) => void) | null = null;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = drainQueue();
    const second = drainQueue(); // no-op while the first is in flight
    // Wait until the first drain is actually blocked inside fetch.
    await vi.waitFor(() => {
      if (resolveFetch === null) {
        throw new Error('fetch not called yet');
      }
    });
    (resolveFetch as unknown as (r: Response) => void)(okEnvelope());
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await listPendingOps()).toHaveLength(0);
  });

  it('refreshSyncState reflects pending and failed counts', async () => {
    const op: QueuedSaleOp = await enqueueSale(PAYLOAD, crypto.randomUUID());
    await offlineDb.saleOps.update(op.seq ?? -1, { status: 'failed', lastError: 'nope' });
    await enqueueSale(PAYLOAD, crypto.randomUUID());

    await refreshSyncState();

    expect(useSyncStore.getState().pendingCount).toBe(1);
    expect(useSyncStore.getState().failed).toHaveLength(1);
  });
});
