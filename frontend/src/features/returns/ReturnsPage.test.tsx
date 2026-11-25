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
  invoice_prefix: 'INV',
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

let owes = 0;

function quoteFor(qty: number) {
  return {
    return_total: (qty * 450).toFixed(2),
    new_total: '0.00',
    to_collect: '0.00',
    to_refund: (qty * 450).toFixed(2),
    max_credit_note: Math.min(owes, qty * 450).toFixed(2),
  };
}

function refusal(message: string): Response {
  return new Response(
    JSON.stringify({ data: null, error: { code: 'OVER_RETURN', message, details: null } }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );
}

async function openBill(qty: string) {
  renderReturns();
  fireEvent.click(await screen.findByRole('button', { name: /Invoice INV-1/ }));
  await screen.findByText('Basic T-shirt');
  fireEvent.change(screen.getByLabelText('Return quantity for Basic T-shirt'), {
    target: { value: qty },
  });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Wrong size' } });
}

async function recordedRefunds() {
  fireEvent.click(screen.getByRole('button', { name: 'Record return' }));
  await screen.findByText('Return recorded.');
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v1/sales/returns'));
  return JSON.parse(String(call?.[1]?.body)).refunds;
}

describe('ReturnsPage', () => {
  beforeEach(() => {
    owes = 0;
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/sales?')) return page([sale]);
      if (url.endsWith('/v1/sales/sale-1/returnable')) return envelope([line]);
      if (url.endsWith('/v1/sales/sale-1/return-quote')) {
        const { returned_lines } = JSON.parse(String(init?.body));
        if (Number(returned_lines[0].qty) > 2) return refusal('Only 2 left to return.');
        return envelope(quoteFor(Number(returned_lines[0].qty)));
      }
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

    fireEvent.click(await screen.findByRole('button', { name: /Invoice INV-1/ }));

    expect(await screen.findByText('Basic T-shirt')).toBeInTheDocument();
    expect(screen.getByText('TSHIRT-M-BLK')).toBeInTheDocument();
  });

  it('records selected return lines with a required reason', async () => {
    await openBill('1');

    expect(await screen.findByText('Return value: रू 450.00')).toBeInTheDocument();
    expect(screen.queryByLabelText(/off what they owe/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Give back (रू)')).toHaveValue('450.00');
    expect(await recordedRefunds()).toEqual([{ method: 'CASH', amount: '450.00' }]);
  });

  it('takes the return off what the customer owes, and gives back the rest', async () => {
    owes = 300;
    await openBill('1');

    const credit = await screen.findByLabelText('Take off what they owe (रू)');
    expect(credit).toHaveValue('300.00');
    expect(screen.getByLabelText('Give back (रू)')).toHaveValue('150.00');

    fireEvent.change(credit, { target: { value: '100' } });
    expect(screen.getByLabelText('Give back (रू)')).toHaveValue('350.00');
    expect(await recordedRefunds()).toEqual([
      { method: 'CREDIT_NOTE', amount: '100.00' },
      { method: 'CASH', amount: '350.00' },
    ]);
  });

  it('says when part of the value is not given back', async () => {
    await openBill('1');
    await screen.findByText('Return value: रू 450.00');
    const money = screen.getByLabelText('Give back (रू)');

    fireEvent.change(money, { target: { value: '' } });

    expect(screen.getByText('रू 450.00 of this is not given back.')).toBeInTheDocument();
    expect(await recordedRefunds()).toBeUndefined();
  });

  it('will not record more than the return is worth', async () => {
    await openBill('1');
    await screen.findByText('Return value: रू 450.00');
    const money = screen.getByLabelText('Give back (रू)');

    fireEvent.change(money, { target: { value: '450.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record return' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('more than the return value');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/v1/sales/returns'))).toBe(
      false,
    );
  });

  it('forgets a typed refund when the quantity changes', async () => {
    await openBill('1');
    await screen.findByText('Return value: रू 450.00');
    fireEvent.change(screen.getByLabelText('Give back (रू)'), { target: { value: '10' } });

    fireEvent.change(screen.getByLabelText('Return quantity for Basic T-shirt'), {
      target: { value: '2' },
    });

    // Nothing can be recorded against the old figure.
    expect(screen.getByRole('button', { name: 'Record return' })).toBeDisabled();
    expect(await screen.findByText('Return value: रू 900.00')).toBeInTheDocument();
    expect(screen.getByLabelText('Give back (रू)')).toHaveValue('900.00');
  });

  it('shows why a quantity cannot be returned, and does not record it', async () => {
    await openBill('3');

    expect(await screen.findByRole('alert')).toHaveTextContent('Only 2 left to return.');
    expect(screen.getByRole('button', { name: 'Record return' })).toBeDisabled();
  });

  it('asks for a quantity before anything else', async () => {
    await openBill('0');
    fireEvent.click(screen.getByRole('button', { name: 'Record return' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select a return quantity');
  });

  it.each(['7', 'INV-7', ' inv-7 '])('finds the bill people read as %s', async (typed) => {
    renderReturns();
    await screen.findByRole('button', { name: /Invoice INV-1/ });
    fireEvent.change(screen.getByLabelText('Invoice no.'), { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/invoice_no=7$/),
        expect.anything(),
      ),
    );
  });

  it('searches a completed sale by invoice number and clears back to the list', async () => {
    renderReturns();
    await screen.findByRole('button', { name: /Invoice INV-1/ });

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

  // RET-7 is a credit note: looking up bill 7 for it would return the wrong sale.
  it.each(['abc', 'RET-7'])('rejects %s as a bill to return', async (typed) => {
    renderReturns();
    fireEvent.change(screen.getByLabelText('Invoice no.'), { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    expect(await screen.findByText('Enter a bill number, like INV-42.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('invoice_no'),
      expect.anything(),
    );
  });
});
