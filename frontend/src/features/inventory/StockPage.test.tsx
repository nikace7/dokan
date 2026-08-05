import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StockPage } from '@/features/inventory/StockPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

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

function me(permissions: string[]) {
  return {
    id: 'user-1',
    phone: '9800000000',
    full_name: 'Stock User',
    email: null,
    must_change_password: false,
    is_owner: false,
    permissions,
    plan: { code: 'pro', name: 'Pro', features: {} },
  };
}

const level = {
  id: 'level-1',
  branch: 'branch-1',
  branch_code: 'MAIN',
  variant: 'variant-1',
  variant_sku: 'SHIRT-M',
  item_name: 'Oxford Shirt',
  qty_on_hand: '8.000',
  qty_reserved: '0.000',
  updated_at: '2026-08-05T00:00:00Z',
};

const movement = {
  id: 'movement-1',
  branch: 'branch-1',
  branch_code: 'MAIN',
  variant: 'variant-1',
  variant_sku: 'SHIRT-M',
  type: 'OPENING',
  qty_delta: '10.000',
  balance_after: '10.000',
  note: 'Opening stock',
  business_date_bs: '2083-04-20',
  fiscal_year_bs: '2083-84',
  created_by_name: 'Owner',
  created_at: '2026-08-05T00:00:00Z',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StockPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockBase(permissions: string[]) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/v1/auth/me')) return envelope(me(permissions));
    if (url.includes('/v1/inventory/levels')) return envelope([level]);
    if (url.includes('/v1/inventory/movements')) return envelope([movement]);
    if (url.includes('/v1/branches')) {
      return envelope([{ id: 'branch-1', code: 'MAIN', name: 'Main', is_default: true }]);
    }
    if (url.includes('/v1/pricing/rate-types')) {
      return envelope([{ id: 'retail-1', name: 'Retail', is_default: true, is_active: true }]);
    }
    if (url.includes('/v1/catalog/items')) {
      return envelope([{ id: 'item-1', code: 'SHIRT', name: 'Oxford Shirt', is_active: true }]);
    }
    if (url.includes('/v1/catalog/variants')) {
      return envelope([
        {
          id: 'variant-1',
          item: 'item-1',
          size: 'M',
          color: 'Blue',
          sku: 'SHIRT-M',
          mrp: '1200.00',
          is_active: true,
        },
      ]);
    }
    if (
      (url.includes('/v1/inventory/adjustments') || url.includes('/v1/inventory/write-offs')) &&
      init?.method === 'POST'
    ) {
      return envelope({
        ...movement,
        id: 'movement-new',
        ...(JSON.parse(String(init.body)) as object),
      });
    }
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
}

async function pickVariant() {
  fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'shirt' } });
  fireEvent.click(await screen.findByRole('button', { name: /Oxford Shirt/ }));
  fireEvent.click(await screen.findByRole('button', { name: /M \/ Blue/ }));
}

describe('StockPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    localStorage.clear();
  });

  it('shows levels and immutable movements without write controls to a viewer', async () => {
    mockBase(['stock.view']);
    renderPage();

    expect(await screen.findByText('Oxford Shirt')).toBeInTheDocument();
    expect(screen.getByText('Opening stock')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust stock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write off damage' })).not.toBeInTheDocument();
  });

  it('posts a signed adjustment with a reason', async () => {
    mockBase(['stock.view', 'stock.adjust']);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Adjust stock' }));
    await pickVariant();
    fireEvent.change(screen.getByLabelText('Quantity change'), { target: { value: '-2' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Corrected recount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post adjustment' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/inventory/adjustments'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Corrected recount'),
        }),
      ),
    );
  });

  it('posts a positive damage write-off', async () => {
    mockBase(['stock.view', 'stock.adjust']);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Write off damage' }));
    await pickVariant();
    fireEvent.change(screen.getByLabelText('Quantity damaged'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Water damage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post write-off' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/inventory/write-offs'),
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('Water damage') }),
      ),
    );
  });
});
