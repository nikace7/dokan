import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExchangePage } from '@/features/exchange/ExchangePage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function page(data: unknown[]): Response {
  return new Response(
    JSON.stringify({
      data,
      meta: { count: data.length, page: 1, total_pages: 1, page_size: 20 },
      error: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function renderExchange() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ExchangePage />
    </QueryClientProvider>,
  );
}

const sale = {
  id: 'sale-1',
  branch: 'branch-1',
  branch_code: 'MAIN',
  invoice_no: 1,
  doc_type: 'SALE',
  customer: 'customer-1',
  customer_name: 'Sita Rai',
  rate_type: 'rate-1',
  rate_type_code: 'RETAIL',
  subtotal: '1000.00',
  discount_amount: '0.00',
  taxable_amount: '1000.00',
  vat_amount: '0.00',
  round_off: '0.00',
  total: '1000.00',
  paid_amount: '1000.00',
  due_amount: '0.00',
  status: 'COMPLETED',
  is_vat_bill: false,
  datetime_ad: '2026-08-03T00:00:00Z',
  business_date_ad: '2026-08-03',
  business_date_bs: '2083-04-18',
  fiscal_year_bs: '2083-84',
  created_at: '2026-08-03T00:00:00Z',
};

const returnedLine = {
  variant: 'variant-1',
  sku: 'TSHIRT-M-BLK',
  item_name: 'Basic T-shirt',
  qty: '2.000',
  returned_qty: '0.000',
  remaining: '2.000',
};

const newVariant = {
  id: 'variant-2',
  sku: 'JEANS-M-BLU',
  barcode: '8902',
  size: 'M',
  color: 'Blue',
  color_hex: '#0000ff',
  mrp: '2000.00',
  is_active: true,
  item__name: 'Jeans',
  item__name_np: 'जिन्स',
  item__code: 'JNS',
  image_url: '/media/tenants/t1/items/jeans.png',
};

describe('ExchangePage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/sales?')) return page([sale]);
      if (url.endsWith('/v1/sales/sale-1/returnable')) return envelope([returnedLine]);
      if (url.includes('/v1/catalog/variants/lookup?')) return envelope(newVariant);
      if (url.endsWith('/v1/sales/exchanges')) return envelope({ sale_invoice: sale }, 201);
      throw new Error(`Unhandled request: ${url} ${init?.method ?? 'GET'}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('adds a new item and records an atomic exchange', async () => {
    renderExchange();
    fireEvent.click(await screen.findByRole('button', { name: /Invoice 1/ }));
    await screen.findByText('Basic T-shirt');

    fireEvent.change(screen.getByLabelText('Return quantity for Basic T-shirt'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Wrong size' } });
    fireEvent.change(screen.getByLabelText('New item code'), { target: { value: '8902' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

    expect(await screen.findByText('Jeans')).toBeInTheDocument();
    const linePhoto = screen.getByRole('img', { name: 'Jeans' });
    expect(linePhoto).toHaveAttribute('src', '/media/tenants/t1/items/jeans.png');
    fireEvent.click(screen.getByRole('button', { name: 'Record exchange' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/sales/exchanges'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Exchange recorded.')).toBeInTheDocument();
  });
});
