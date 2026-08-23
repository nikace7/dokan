import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReturnsPage } from '@/features/returns/ReturnsPage';
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

function renderReturns() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReturnsPage />
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

const line = {
  variant: 'variant-1',
  sku: 'TSHIRT-M-BLK',
  item_name: 'Basic T-shirt',
  qty: '2.000',
  returned_qty: '0.000',
  remaining: '2.000',
};

describe('ReturnsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/sales?')) return page([sale]);
      if (url.endsWith('/v1/sales/sale-1/returnable')) return envelope([line]);
      if (url.endsWith('/v1/sales/returns')) return envelope(sale, 201);
      throw new Error(`Unhandled request: ${url} ${init?.method ?? 'GET'}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('loads a completed sale and its returnable lines', async () => {
    renderReturns();

    fireEvent.click(await screen.findByRole('button', { name: /Invoice 1/ }));

    expect(await screen.findByText('Basic T-shirt')).toBeInTheDocument();
    expect(screen.getByText('TSHIRT-M-BLK')).toBeInTheDocument();
  });

  it('records selected return lines with a required reason', async () => {
    renderReturns();
    fireEvent.click(await screen.findByRole('button', { name: /Invoice 1/ }));
    await screen.findByText('Basic T-shirt');

    fireEvent.change(screen.getByLabelText('Return quantity for Basic T-shirt'), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Wrong size' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record return' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/sales/returns'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Return recorded.')).toBeInTheDocument();
  });

  it('searches a completed sale by invoice number and clears back to the list', async () => {
    renderReturns();
    await screen.findByRole('button', { name: /Invoice 1/ });

    fireEvent.change(screen.getByLabelText('Invoice no.'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('invoice_no=7'),
        expect.anything(),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.not.stringContaining('invoice_no'),
        expect.anything(),
      );
    });
  });

  it('rejects a non-numeric invoice search', async () => {
    renderReturns();
    fireEvent.change(screen.getByLabelText('Invoice no.'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    expect(await screen.findByText('Enter a whole invoice number.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('invoice_no'),
      expect.anything(),
    );
  });
});
