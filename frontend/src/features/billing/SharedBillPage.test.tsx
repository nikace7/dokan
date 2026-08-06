import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedBillPage } from '@/features/billing/SharedBillPage';
import { clearTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

const SHARED_BILL = {
  id: 'sale-1',
  tenant_name: 'Shree Ganesh',
  tenant_name_np: 'श्री गणेश',
  legal_name: 'Shree Ganesh Traders Pvt. Ltd.',
  pan_vat_no: '123456789',
  vat_registered: true,
  invoice_prefix: 'INV',
  branch_name: 'Main Outlet',
  branch_name_np: null,
  branch_address: 'New Road, Kathmandu',
  branch_phone: '01-5550000',
  invoice_no: 42,
  doc_type: 'SALE',
  customer_name: null,
  subtotal: '1500.00',
  discount_amount: '0.00',
  taxable_amount: '1500.00',
  vat_amount: '0.00',
  round_off: '0.00',
  total: '1500.00',
  paid_amount: '1500.00',
  due_amount: '0.00',
  status: 'COMPLETED',
  is_vat_bill: false,
  print_count: 1,
  tenders: [{ method: 'QR', amount: '1500.00' }],
  datetime_ad: '2026-07-31T08:00:00+05:45',
  business_date_ad: '2026-07-31',
  business_date_bs: '2083-04-15',
  fiscal_year_bs: '2083-84',
  created_at: '2026-07-31T08:00:00+05:45',
  items: [
    {
      id: 'line-1',
      variant: 'var-1',
      variant_sku: 'TS-BLK-M',
      item_name: 'T-Shirt',
      item_name_np: 'टी-सर्ट',
      qty: '1.000',
      unit_price: '1500.00',
      discount: '0.00',
      line_total: '1500.00',
    },
  ],
};

function renderSharedBill(token: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter([{ path: '/bill/:token', element: <SharedBillPage /> }], {
    initialEntries: [`/bill/${token}`],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('SharedBillPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    clearTokens(); // the whole point: no session, no login redirect
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('renders the shared bill publicly, without any auth token', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/sales/shared/tok-1')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: SHARED_BILL, error: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderSharedBill('tok-1');

    expect(await screen.findByText('Shree Ganesh')).toBeInTheDocument();
    expect(screen.getByText(/PAN\/VAT: 123456789/)).toBeInTheDocument();
    expect(screen.getByText('Invoice INV-42')).toBeInTheDocument();
    expect(screen.getByText(/2083-04-15/)).toBeInTheDocument();
    expect(screen.getByText('T-Shirt')).toBeInTheDocument();
    expect(screen.getByText(/Tender · QR/)).toBeInTheDocument();
    expect(screen.getAllByText('रू 1,500.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/Powered by/)).toBeInTheDocument();

    // The public fetch carried no credentials and /auth/me was never called.
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/v1/sales/shared/tok-1'),
    );
    expect(call).toBeDefined();
    const [, init] = call as [RequestInfo | URL, RequestInit];
    expect((init?.headers as Headers | undefined)?.get('Authorization') ?? null).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/auth/me'))).toBe(false);
  });

  it('shows a friendly not-found state for an unknown token', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: null,
            error: { code: 'BILL_NOT_FOUND', message: 'We could not find this bill.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    renderSharedBill('tok-unknown');

    expect(
      await screen.findByRole('heading', { name: 'Bill not found / बिल भेटिएन' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
  });
});
