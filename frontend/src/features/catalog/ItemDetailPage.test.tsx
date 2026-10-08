import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemDetailPage } from '@/features/catalog/ItemDetailPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, meta?: object, status = 200): Response {
  return new Response(JSON.stringify({ data, meta: meta ?? null, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PAGE_META = { count: 2, page: 1, total_pages: 1, page_size: 25 };

const ITEM = {
  id: 'item-1',
  code: 'TS',
  name: 'T-Shirt',
  name_np: 'टीसर्ट',
  category: 'cat-1',
  brand: 'brand-1',
  size_chart: null,
  gender: 'M',
  season: null,
  collection_tag: null,
  hsn_code: null,
  unit: 'PCS',
  is_vat_applicable: true,
  image_url: '/media/tenants/t1/items/ts.png',
  variants_count: null,
  mrp_min: null,
  mrp_max: null,
  min_selling_price: null,
  max_selling_price: null,
  reorder_level: '5',
  is_active: true,
};

const VARIANTS = [
  {
    id: 'var-1',
    item: 'item-1',
    size: 'M',
    color: 'Black',
    color_hex: '#111111',
    sku: 'TS-M-BLK',
    barcode: '8901234567890',
    mrp: '1000.00',
    min_selling_price: null,
    max_selling_price: null,
    is_active: true,
  },
  {
    id: 'var-2',
    item: 'item-1',
    size: 'L',
    color: 'White',
    color_hex: null,
    sku: 'TS-L-WHT',
    barcode: null,
    mrp: '1200.00',
    min_selling_price: null,
    max_selling_price: null,
    is_active: true,
  },
];

function installApiMock(permissions = ['catalog.view', 'catalog.manage']) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/v1/auth/me')) {
      return Promise.resolve(envelope({ id: 'user-1', permissions, plan: null }));
    }
    if (url.includes('/v1/catalog/items/item-1') && method === 'DELETE') {
      return Promise.resolve(envelope({ id: 'item-1', is_active: false }));
    }
    if (url.includes('/v1/catalog/items/item-1')) {
      return Promise.resolve(envelope(ITEM));
    }
    if (url.includes('/v1/catalog/variants')) {
      return Promise.resolve(envelope(VARIANTS, PAGE_META));
    }
    if (url.includes('/v1/catalog/categories')) {
      return Promise.resolve(
        envelope(
          [
            {
              id: 'cat-1',
              parent: null,
              name: 'Shirts',
              name_np: null,
              size_chart: null,
              default_margin_pct: null,
              min_price_pct: null,
              max_price_pct: null,
              sort_order: 0,
              is_active: true,
            },
          ],
          PAGE_META,
        ),
      );
    }
    if (url.includes('/v1/catalog/brands')) {
      return Promise.resolve(
        envelope([{ id: 'brand-1', name: 'Nike', is_active: true }], PAGE_META),
      );
    }
    if (url.includes('/v1/catalog/size-charts')) {
      return Promise.resolve(envelope([], PAGE_META));
    }
    return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
  });
}

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/catalog/items/item-1']}>
        <Routes>
          <Route path="/catalog/items/:id" element={<ItemDetailPage />} />
          <Route path="/catalog" element={<p>Catalog grid</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ItemDetailPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    installApiMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('renders the product layout with badges, MRP range, and variant rows', async () => {
    renderDetail();

    expect(await screen.findByText('T-Shirt (TS)')).toBeInTheDocument();
    expect(screen.getByText('Shirts')).toBeInTheDocument();
    expect(screen.getByText('Nike')).toBeInTheDocument();
    expect(screen.getByText('Men')).toBeInTheDocument();
    // Range is computed from the variants: रू 1,000.00 – रू 1,200.00 (and the
    // variant rows repeat those figures, so allow multiple matches).
    expect(screen.getAllByText(/1,000\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1,200\.00/).length).toBeGreaterThan(0);
    // Variants render in both the desktop table and the mobile cards.
    expect(screen.getAllByText('TS-M-BLK').length).toBeGreaterThan(0);
    expect(screen.getAllByText('TS-L-WHT').length).toBeGreaterThan(0);
  });

  it('opens a full-screen photo preview and dismisses it with Escape', async () => {
    renderDetail();

    await screen.findByText('T-Shirt (TS)');
    fireEvent.click(screen.getByRole('button', { name: 'View full photo' }));

    const dialog = screen.getByRole('dialog', { name: 'T-Shirt' });
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deactivates only after an explicit confirm, then returns to the catalog', async () => {
    renderDetail();

    await screen.findByText('T-Shirt (TS)');
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));

    // No DELETE until the confirm button is pressed.
    expect(fetchMock.mock.calls.some(([, init]) => (init?.method ?? 'GET') === 'DELETE')).toBe(
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivate' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/v1/catalog/items/item-1') &&
            (init?.method ?? 'GET') === 'DELETE',
        ),
      ).toBe(true);
    });
    expect(await screen.findByText('Catalog grid')).toBeInTheDocument();
  });

  it('shows a view-only role the item without Edit or Deactivate', async () => {
    installApiMock(['catalog.view']);
    renderDetail();

    await screen.findByText('T-Shirt (TS)');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/v1/auth/me'))).toBe(
        true,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
  });
});
