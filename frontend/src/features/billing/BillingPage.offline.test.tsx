import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingPage } from '@/features/billing/BillingPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';
import { offlineDb } from '@/lib/offline/db';
import { listPendingOps } from '@/lib/offline/queue';
import { cancelScheduledRetry, useSyncStore } from '@/lib/offline/sync';
import { useCartStore } from '@/stores/cartStore';

vi.mock('@/features/settings/useWorkspace', () => ({
  useWorkspace: () => ({
    branches: [{ id: 'branch-1', name: 'Main', is_default: true }],
    rateTypes: [{ id: 'rate-1', name: 'Retail', is_default: true }],
    branchId: 'branch-1',
    rateTypeId: 'rate-1',
    setBranchId: vi.fn(),
    setRateTypeId: vi.fn(),
    isReady: true,
    isLoading: false,
    error: null,
  }),
}));

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VARIANT = {
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

describe('BillingPage offline', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    useCartStore.getState().clear();
    await offlineDb.saleOps.clear();
    await offlineDb.variantCache.clear();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(
          envelope({
            id: 'user-1',
            phone: '9800000000',
            full_name: 'Demo Owner',
            email: null,
            must_change_password: false,
            permissions: ['sale.create'],
            plan: { code: 'basic', name: 'Basic', features: { vat_module: true } },
          }),
        );
      }
      if (url.includes('/v1/catalog/variants/lookup')) {
        return Promise.resolve(envelope(VARIANT));
      }
      if (url.includes('/v1/sales/held')) {
        return Promise.resolve(envelope([]));
      }
      if (url.endsWith('/api/v1/sales') && method === 'POST') {
        // The network is down: fetch rejects before any HTTP answer.
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    });
  });

  afterEach(async () => {
    cancelScheduledRetry();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    useCartStore.getState().clear();
    await offlineDb.saleOps.clear();
    await offlineDb.variantCache.clear();
  });

  it('queues the sale with the attempt’s Idempotency-Key and shows a provisional ref', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <BillingPage />
      </QueryClientProvider>,
    );

    // Scan an item into the cart.
    const input = screen.getByLabelText(/scan barcode or type sku/i);
    fireEvent.change(input, { target: { value: '8901234567890' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    // The label renders twice: the cart row and the last-scanned card.
    expect((await screen.findAllByText('T-Shirt — M / Black')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /complete sale/i }));

    // Offline receipt: provisional reference, never an invoice number.
    expect(await screen.findByText('No connection — bill queued')).toBeInTheDocument();
    expect(screen.getByText(/^Reference OFF-[0-9A-F]{8}$/)).toBeInTheDocument();

    // The queued op reuses the exact Idempotency-Key the failed attempt sent.
    const saleCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/v1/sales') && (init?.method ?? 'GET') === 'POST',
    );
    expect(saleCall).toBeDefined();
    const sentKey = (saleCall?.[1]?.headers as Headers).get('Idempotency-Key');
    const [op] = await listPendingOps();
    expect(op.idempotencyKey).toBe(sentKey);
    expect(op.payload.lines).toEqual([{ variant: 'var-1', qty: '1', discount: '0.00' }]);

    // Cart cleared; the sync store shows the pending bill.
    expect(useCartStore.getState().lines).toHaveLength(0);
    await waitFor(() => expect(useSyncStore.getState().pendingCount).toBe(1));

    // "New bill" returns to an empty cart.
    fireEvent.click(screen.getByRole('button', { name: /new bill/i }));
    expect(await screen.findByText(/cart is empty/i)).toBeInTheDocument();
  });
});
