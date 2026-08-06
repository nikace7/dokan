import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemsPage } from '@/features/catalog/ItemsPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, meta?: object, status = 200): Response {
  return new Response(JSON.stringify({ data, meta: meta ?? null, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PAGE_META = { count: 1, page: 1, total_pages: 1, page_size: 25 };

const ITEM = {
  id: 'item-1',
  code: 'TS',
  name: 'T-Shirt',
  name_np: 'टीसर्ट',
  category: null,
  brand: null,
  size_chart: null,
  gender: 'U',
  season: null,
  collection_tag: null,
  hsn_code: null,
  unit: 'PCS',
  is_vat_applicable: false,
  min_selling_price: null,
  max_selling_price: null,
  reorder_level: null,
  is_active: true,
};

function renderItems() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ItemsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ItemsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/catalog/categories')) {
        return Promise.resolve(envelope([], PAGE_META));
      }
      if (url.includes('/v1/catalog/items')) {
        return Promise.resolve(envelope([ITEM], PAGE_META));
      }
      return Promise.reject(new Error(`Unexpected request: GET ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('lists items and refetches with the search term', async () => {
    renderItems();

    // Initial load renders the row (mobile card + desktop table).
    expect((await screen.findAllByText('T-Shirt')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('TS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);

    // Typing a search term refetches with `search=` on the query string.
    fetchMock.mockClear();
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'shirt' } });

    await waitFor(() => {
      const searched = fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/v1/catalog/items?search=shirt'),
      );
      expect(searched).toBe(true);
    });
    // Row still renders from the (mocked) filtered response.
    expect((await screen.findAllByText('T-Shirt')).length).toBeGreaterThan(0);
  });

  it('filters by status through the is_active query param', async () => {
    renderItems();
    await screen.findAllByText('T-Shirt');

    fetchMock.mockClear();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'inactive' } });

    await waitFor(() => {
      const filtered = fetchMock.mock.calls.some(
        ([url]) =>
          String(url).includes('/v1/catalog/items') && String(url).includes('is_active=false'),
      );
      expect(filtered).toBe(true);
    });
  });
});
