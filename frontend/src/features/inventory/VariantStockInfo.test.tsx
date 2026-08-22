import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VariantStockInfo } from '@/features/inventory/VariantStockInfo';
import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

const variant: PickedVariant = {
  id: 'variant-1',
  sku: 'JACKET-M-BLK',
  size: 'M',
  color: 'Black',
  mrp: '1800.00',
  itemName: 'Thin Sunblock',
  minPrice: '1400.00',
  maxPrice: '1600.00',
};

function envelope(data: unknown): Response {
  return new Response(
    JSON.stringify({
      data,
      meta: Array.isArray(data)
        ? { count: data.length, page: 1, page_size: 50, total_pages: 1 }
        : null,
      error: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function renderInfo(v: PickedVariant = variant, branchId: string | null = 'branch-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VariantStockInfo variant={v} branchId={branchId} />
    </QueryClientProvider>,
  );
}

describe('VariantStockInfo', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });

  afterEach(() => {
    fetchMock.mockReset();
    clearTokens();
  });

  it('shows MRP, the selling range, and the on-hand pieces at the branch', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      expect(url).toContain('/v1/inventory/levels');
      expect(url).toContain('variant=variant-1');
      return envelope([
        {
          id: 'level-1',
          branch: 'branch-1',
          branch_code: 'MAIN',
          variant: 'variant-1',
          variant_sku: 'JACKET-M-BLK',
          item_name: 'Thin Sunblock',
          qty_on_hand: '8.000',
          qty_reserved: '0.000',
          updated_at: '2026-08-05T00:00:00Z',
        },
      ]);
    });
    renderInfo();
    expect(screen.getByText('MRP')).toBeInTheDocument();
    expect(screen.getByText('रू 1,800.00')).toBeInTheDocument();
    expect(screen.getByText('रू 1,400.00 – रू 1,600.00')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument());
  });

  it('shows "Not set" and 0 when no price range or stock row exists', async () => {
    fetchMock.mockImplementation(async () => envelope([]));
    renderInfo({ ...variant, minPrice: null, maxPrice: null });
    expect(screen.getByText('Not set')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument());
    // No level row → no photo URL → aria-hidden placeholder tile, no <img>.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the item photo from the level row beside the variant name', async () => {
    fetchMock.mockImplementation(async () =>
      envelope([
        {
          id: 'level-1',
          branch: 'branch-1',
          branch_code: 'MAIN',
          variant: 'variant-1',
          variant_sku: 'JACKET-M-BLK',
          item_name: 'Thin Sunblock',
          image_url: '/media/items/sunblock.jpg',
          qty_on_hand: '8.000',
          qty_reserved: '0.000',
          reorder_level: null,
          is_low: false,
          updated_at: '2026-08-05T00:00:00Z',
        },
      ]),
    );
    renderInfo();
    expect(await screen.findByRole('img', { name: 'Thin Sunblock' })).toBeInTheDocument();
  });
});
