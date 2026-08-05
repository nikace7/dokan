import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lookupVariant } from '@/features/billing/api';
import type { VariantLookup } from '@/features/billing/api';
import { clearTokens, setTokens } from '@/lib/auth/tokens';
import { cacheVariant, lookupCachedVariant } from '@/lib/offline/catalogCache';
import { discardException, listExceptions, summarizeOp } from '@/lib/offline/conflicts';
import { offlineDb } from '@/lib/offline/db';
import { enqueueSale } from '@/lib/offline/queue';
import { useSyncStore } from '@/lib/offline/sync';
import type { CreateSalePayload } from '@/features/billing/api';

const fetchMock = vi.fn<typeof fetch>();

const VARIANT: VariantLookup = {
  id: 'var-1',
  sku: 'TS-BLK-M',
  barcode: '8901234567890',
  size: 'M',
  color: 'Black',
  color_hex: '#000000',
  mrp: '1500.00',
  is_active: true,
  item__name: 'T-Shirt',
  item__name_np: 'टीसर्ट',
  item__code: 'TS',
};

const PAYLOAD: CreateSalePayload = {
  branch: 'branch-1',
  rate_type: 'rate-1',
  lines: [{ variant: 'var-1', qty: '1', discount: '0.00' }],
  payments: [{ method: 'CASH', amount: '1500.00' }],
  is_vat_bill: false,
};

describe('offline catalog cache', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    await offlineDb.variantCache.clear();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    await offlineDb.variantCache.clear();
  });

  it('finds cached variants by barcode and by SKU', async () => {
    await cacheVariant(VARIANT);

    const byBarcode = await lookupCachedVariant('8901234567890');
    const bySku = await lookupCachedVariant('TS-BLK-M');
    expect(byBarcode?.id).toBe('var-1');
    expect(byBarcode?.item__name).toBe('T-Shirt');
    expect(byBarcode?.mrp).toBe('1500.00');
    expect(bySku?.id).toBe('var-1');
    expect(await lookupCachedVariant('NOPE')).toBeUndefined();
  });

  it('serves billing lookups from the cache when the network is down', async () => {
    await cacheVariant(VARIANT);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const found = await lookupVariant('8901234567890');

    expect(found.id).toBe('var-1');
    expect(found.item__name).toBe('T-Shirt');
  });

  it('refreshes the cache on every successful online lookup', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: VARIANT, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await lookupVariant('8901234567890');

    expect((await lookupCachedVariant('8901234567890'))?.id).toBe('var-1');
  });

  it('a cache miss offline surfaces the network error, not a phantom 404', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(lookupVariant('UNKNOWN')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('conflict exceptions (server wins)', () => {
  beforeEach(async () => {
    await offlineDb.saleOps.clear();
  });

  afterEach(async () => {
    await offlineDb.saleOps.clear();
  });

  it('lists failed ops and discards them locally', async () => {
    const op = await enqueueSale(PAYLOAD, crypto.randomUUID());
    await offlineDb.saleOps.update(op.seq ?? -1, {
      status: 'failed',
      lastError: 'Cash session is closed.',
      failedAt: new Date().toISOString(),
    });

    const exceptions = await listExceptions();
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].lastError).toBe('Cash session is closed.');
    expect(summarizeOp(exceptions[0])).toBe('1 line');

    await discardException(op.seq ?? -1);

    expect(await listExceptions()).toHaveLength(0);
    expect(await offlineDb.saleOps.count()).toBe(0);
    expect(useSyncStore.getState().failed).toHaveLength(0);
  });
});
