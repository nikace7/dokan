import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { offlineDb } from '@/lib/offline/db';
import { countPendingOps, enqueueSale, listPendingOps, localRefFor } from '@/lib/offline/queue';
import type { CreateSalePayload } from '@/features/billing/api';

export const SALE_PAYLOAD: CreateSalePayload = {
  branch: 'branch-1',
  rate_type: 'rate-1',
  lines: [{ variant: 'var-1', qty: '1', discount: '0.00' }],
  payments: [{ method: 'CASH', amount: '1500.00' }],
  is_vat_bill: false,
};

describe('offline queue', () => {
  beforeEach(async () => {
    await offlineDb.saleOps.clear();
  });

  afterEach(async () => {
    await offlineDb.saleOps.clear();
  });

  it('enqueues a pending op with its Idempotency-Key and a provisional ref', async () => {
    const key = crypto.randomUUID();
    const op = await enqueueSale(SALE_PAYLOAD, key);

    expect(op.status).toBe('pending');
    expect(op.attempts).toBe(0);
    expect(op.idempotencyKey).toBe(key);
    expect(op.localRef).toBe(localRefFor(key));
    expect(op.localRef).toMatch(/^OFF-[0-9A-F]{8}$/);
    expect(op.seq).toBeGreaterThan(0);
    expect(await countPendingOps()).toBe(1);
  });

  it('dedupes on the Idempotency-Key — same attempt never enqueues twice', async () => {
    const key = crypto.randomUUID();
    const first = await enqueueSale(SALE_PAYLOAD, key);
    const second = await enqueueSale(SALE_PAYLOAD, key);

    expect(second.seq).toBe(first.seq);
    expect(await countPendingOps()).toBe(1);
  });

  it('lists pending ops in FIFO (enqueue) order', async () => {
    await enqueueSale(SALE_PAYLOAD, crypto.randomUUID());
    await enqueueSale(SALE_PAYLOAD, crypto.randomUUID());
    await enqueueSale(SALE_PAYLOAD, crypto.randomUUID());

    const seqs = (await listPendingOps()).map((op) => op.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});
