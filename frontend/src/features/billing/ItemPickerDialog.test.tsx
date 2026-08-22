import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemPickerDialog } from '@/features/billing/ItemPickerDialog';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

/** List endpoints carry pagination meta alongside the data envelope. */
function pageEnvelope(rows: unknown[]): Response {
  return new Response(
    JSON.stringify({
      data: rows,
      meta: { count: rows.length, page: 1, total_pages: 1, page_size: 50 },
      error: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const TSHIRT = {
  id: 'var-1',
  item: 'item-1',
  item_name: 'T-Shirt',
  size: 'M',
  color: 'Black',
  sku: 'TS-BLK-M',
  barcode: '8901234567890',
  mrp: '1500.00',
  image_url: '/media/tenants/t1/items/tshirt.png',
  qty_on_hand: '5.000',
  min_selling_price: '1200.00',
  max_selling_price: '1600.00',
};

const JEANS = {
  id: 'var-2',
  item: 'item-2',
  item_name: 'Jeans',
  size: '32',
  color: 'Blue',
  sku: 'JN-BLU-32',
  barcode: '8901234567891',
  mrp: '2500.00',
  image_url: null,
  qty_on_hand: '3.000',
  min_selling_price: null,
  max_selling_price: null,
};

function renderDialog() {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ItemPickerDialog open branchId="branch-1" onOpenChange={onOpenChange} onPick={onPick} />
    </QueryClientProvider>,
  );
  return { onPick, onOpenChange };
}

describe('ItemPickerDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access-1', refresh: 'refresh-1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('renders a photo grid with MRP and stock, and picking a cell hands over the row', async () => {
    fetchMock.mockResolvedValue(pageEnvelope([TSHIRT, JEANS]));
    const { onPick } = renderDialog();

    const dialog = await screen.findByRole('dialog');
    const tshirtCell = await within(dialog).findByRole('button', { name: /T-Shirt/ });

    // Responsive grid of cells, two columns on phones, three from sm up.
    const grid = tshirtCell.parentElement as HTMLElement;
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('sm:grid-cols-3');

    // Square photo on top; Jeans (no photo) falls back to the placeholder tile.
    const photo = within(tshirtCell).getByRole('img', { name: 'T-Shirt' });
    expect(photo).toHaveAttribute('src', '/media/tenants/t1/items/tshirt.png');
    expect(photo.className).toContain('aspect-square');
    expect(
      within(within(dialog).getByRole('button', { name: /Jeans/ })).queryByRole('img'),
    ).not.toBeInTheDocument();

    // MRP and the stock line render inside the cell.
    expect(within(tshirtCell).getByText('रू 1,500.00')).toBeInTheDocument();
    expect(within(tshirtCell).getByText('Stock 5.000')).toBeInTheDocument();
    expect(
      within(within(dialog).getByRole('button', { name: /Jeans/ })).getByText('रू 2,500.00'),
    ).toBeInTheDocument();

    // The pick contract is unchanged: the whole row goes to the caller.
    fireEvent.click(tshirtCell);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'var-1', sku: 'TS-BLK-M' }));
  });

  it('shows card-shaped skeletons while the search is pending', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    renderDialog();

    const dialog = await screen.findByRole('dialog');
    const status = within(dialog).getByRole('status');
    expect(status.className).toContain('grid-cols-2');
    expect(status.querySelectorAll('.aspect-square').length).toBeGreaterThan(0);
  });
});
