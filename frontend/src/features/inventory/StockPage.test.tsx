import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  image_url: null as string | null,
  qty_on_hand: '8.000',
  qty_reserved: '0.000',
  reorder_level: null as string | null,
  is_low: false,
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

function mockBase(permissions: string[], levels: (typeof level)[] = [level]) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/v1/auth/me')) return envelope(me(permissions));
    if (url.includes('/v1/inventory/summary')) {
      return envelope({
        total_qty_on_hand: '13.500',
        total_qty_reserved: '3.000',
        total_qty_available: '10.500',
        ...(permissions.includes('pricing.view_cost') ? { stock_value: '1900.00' } : {}),
      });
    }
    if (url.includes('/v1/inventory/levels')) return envelope(levels);
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
  // Scope to the operation dialog: level rows are now buttons whose names also
  // match the item name, so an unscoped findByRole would see both.
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Search items'), { target: { value: 'shirt' } });
  fireEvent.click(await within(dialog).findByRole('button', { name: /Oxford Shirt/ }));
  // The mocked item has exactly one variant, so the picker auto-picks it and
  // the picked chip (name — size / colour) replaces the picker.
  await within(dialog).findByText(/M \/ Blue/);
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

    // Rows render twice (mobile card + desktop table).
    expect((await screen.findAllByText('Oxford Shirt')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Opening stock').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Adjust stock' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write off damage' })).not.toBeInTheDocument();
  });

  it('shows tenant-wide on-hand, reserved, and available stock totals', async () => {
    mockBase(['stock.view']);
    renderPage();

    expect(await screen.findByText('Total stock')).toBeInTheDocument();
    expect(screen.getByText('13.5')).toBeInTheDocument();
    expect(screen.getByText('Reserved stock')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Available stock')).toBeInTheDocument();
    expect(screen.getByText('10.5')).toBeInTheDocument();
    expect(screen.queryByText('Stock value')).not.toBeInTheDocument();
  });

  it('shows tenant-wide stock value only with cost visibility', async () => {
    mockBase(['stock.view', 'pricing.view_cost']);
    renderPage();

    expect(await screen.findByText('Stock value')).toBeInTheDocument();
    expect(screen.getByText('रू 1,900.00')).toBeInTheDocument();
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

  it('renders item photos in level rows, with a placeholder tile when no photo', async () => {
    mockBase(
      ['stock.view'],
      [
        { ...level, image_url: '/media/items/shirt.jpg' },
        {
          ...level,
          id: 'level-2',
          variant: 'variant-2',
          item_name: 'Plain Tee',
          variant_sku: 'TEE-L',
        },
      ],
    );
    renderPage();

    // Rows render twice (mobile card + desktop table), so the photo does too.
    expect((await screen.findAllByRole('img', { name: 'Oxford Shirt' })).length).toBe(2);
    // image_url null → aria-hidden placeholder tile, never an <img>.
    expect(screen.getAllByText('Plain Tee').length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { name: 'Plain Tee' })).not.toBeInTheDocument();
  });

  it('flags low rows with a warning chip, keeps out-of-stock destructive, healthy rows bare', async () => {
    mockBase(
      ['stock.view'],
      [
        { ...level, is_low: true, reorder_level: '10.000' },
        {
          ...level,
          id: 'level-2',
          variant: 'variant-2',
          item_name: 'Plain Tee',
          variant_sku: 'TEE-L',
        },
        {
          ...level,
          id: 'level-3',
          variant: 'variant-3',
          item_name: 'Worn Belt',
          variant_sku: 'BELT-M',
          qty_on_hand: '0.000',
          is_low: true,
          reorder_level: '5.000',
        },
      ],
    );
    renderPage();

    await screen.findAllByText('Worn Belt');
    // Low row: one chip in the mobile card + one in the desktop flag cell.
    expect(screen.getAllByText('Low').length).toBe(2);
    // qty 0 wins over the low flag — destructive badge, no "Low" chip for it.
    expect(screen.getAllByText('Out of stock').length).toBe(2);
  });

  it('opens the variant stock dialog from a level row', async () => {
    mockBase(['stock.view']);
    renderPage();

    const rowButtons = await screen.findAllByRole('button', { name: /Oxford Shirt/ });
    fireEvent.click(rowButtons[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('MRP')).toBeInTheDocument();
    expect(within(dialog).getByText('SHIRT-M')).toBeInTheDocument();
    // VariantStockInfo refetches the level for this branch/variant → on-hand 8.
    await waitFor(() => expect(within(dialog).getByText('8')).toBeInTheDocument());
  });
});
