import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillDetailPage } from '@/features/bills/BillDetailPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const BILL = {
  id: 'bill-1',
  tenant_name: 'Yak Handlooms',
  tenant_name_np: null,
  legal_name: null,
  pan_vat_no: '600123456',
  vat_registered: true,
  branch: 'branch-1',
  branch_code: 'MAIN',
  invoice_prefix: 'MAIN',
  branch_name: 'Main shop',
  branch_name_np: null,
  branch_address: null,
  branch_phone: null,
  invoice_no: 42,
  doc_type: 'SALE',
  status: 'COMPLETED',
  customer: null,
  customer_name: 'Ram Thapa',
  rate_type_code: 'RETAIL',
  subtotal: '2000.00',
  discount_amount: '100.00',
  discount_reason: 'Festival offer',
  taxable_amount: '1900.00',
  vat_amount: '247.00',
  round_off: '0.00',
  total: '2147.00',
  paid_amount: '2000.00',
  due_amount: '147.00',
  is_vat_bill: true,
  print_count: 1,
  tenders: [{ method: 'ESEWA', amount: '2000.00' }],
  datetime_ad: '2026-09-26T10:00:00Z',
  business_date_ad: '2026-09-26',
  business_date_bs: '2083-06-10',
  fiscal_year_bs: '2083/84',
  created_by_name: 'Sita Cashier',
  created_at: '2026-09-26T10:00:00Z',
  items: [
    {
      id: 'line-1',
      variant: 'v-1',
      variant_sku: 'SHAWL-RED',
      item_name: 'Pashmina shawl',
      item_name_np: null,
      qty: '2.000',
      unit_price: '1050.00',
      discount: '100.00',
      line_total: '2000.00',
      returned_qty: '1.000',
    },
  ],
};

/** Serves the bill, plus /auth/me with the given permissions. */
function serveBill(bill: unknown, permissions = ['sale.view', 'sale.create']) {
  fetchMock.mockImplementation(async (input) =>
    String(input).includes('/v1/auth/me')
      ? respond(200, { data: { id: 'user-1', permissions, plan: null }, error: null })
      : respond(200, { data: bill, error: null }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/bills/bill-1']}>
        <Routes>
          <Route path="/bills/:id" element={<BillDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BillDetailPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('shows who and when, every line, and the calculation step by step', async () => {
    serveBill(BILL);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Bill MAIN-42' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => /\/v1\/sales\/bill-1$/.test(String(input)))).toBe(
      true,
    );
    expect(screen.getByText('Sita Cashier')).toBeInTheDocument();
    expect(screen.getByText('Festival offer')).toBeInTheDocument();
    expect(screen.getByText('VAT bill')).toBeInTheDocument();

    // Once in the calculation table, once on the printable receipt.
    expect(screen.getAllByText('Pashmina shawl')).toHaveLength(2);
    expect(screen.getByText('1 returned')).toBeInTheDocument();
    expect(screen.getByText('Taxable amount')).toBeInTheDocument();
    expect(screen.getByText('Bill discount')).toBeInTheDocument();
    expect(screen.getAllByText('Due (udharo)')).toHaveLength(2);
    expect(screen.getAllByText(/1,900/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/247/).length).toBeGreaterThan(0);
  });

  it('offers reprint and share for a completed bill, without checkout buttons', async () => {
    serveBill(BILL);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Reprint' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New bill' })).not.toBeInTheDocument();
    expect(screen.queryByText('Sale completed')).not.toBeInTheDocument();
  });

  it('hides Reprint from a view-only role, since every print is recorded', async () => {
    serveBill(BILL, ['sale.view']);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Bill MAIN-42' })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/v1/auth/me'))).toBe(
        true,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Reprint' })).not.toBeInTheDocument();
  });

  it('shows a held bill without a receipt to print', async () => {
    serveBill({ ...BILL, status: 'HELD', invoice_no: null });
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Held bill (no number yet)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Held')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprint' })).not.toBeInTheDocument();
  });

  it('says so when the bill does not exist', async () => {
    fetchMock.mockResolvedValue(
      respond(404, { data: null, error: { code: 'INVOICE_NOT_FOUND', message: 'Not found.' } }),
    );
    renderPage();

    expect(await screen.findByText('This bill was not found.')).toBeInTheDocument();
  });
});
