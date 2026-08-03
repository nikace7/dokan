import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentsPage } from '@/features/payments/PaymentsPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

vi.mock('@/lib/config', () => ({ demoConfig: { branchId: 'branch-1' } }));

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

function renderPayments() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentsPage />
    </QueryClientProvider>,
  );
}

const customer = {
  id: 'customer-1',
  name: 'Sita Rai',
  phone: '9800000000',
  address: '',
  credit_limit: '10000.00',
  is_active: true,
};

const payment = {
  id: 'payment-1',
  branch: 'branch-1',
  branch_code: 'MAIN',
  direction: 'RECEIPT',
  party_type: 'CUSTOMER',
  customer: customer.id,
  customer_name: customer.name,
  supplier: null,
  supplier_name: null,
  method: 'CASH',
  amount: '2500.00',
  ref_no: '',
  note: 'Khata collection',
  business_date_ad: '2026-08-03',
  business_date_bs: '2083-04-18',
  fiscal_year_bs: '2083-84',
  created_by: 'user-1',
  created_at: '2026-08-03T00:00:00Z',
  allocations: [],
};

describe('PaymentsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/payments?')) return page([payment]);
      if (url.includes('/v1/customers?')) return envelope([customer]);
      if (url.endsWith('/v1/payments/receipts')) return envelope(payment, 201);
      throw new Error(`Unhandled request: ${url} ${init?.method ?? 'GET'}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('renders recent customer receipts', async () => {
    renderPayments();

    expect(await screen.findByText('Khata collection')).toBeInTheDocument();
    expect(screen.getByText('Sita Rai')).toBeInTheDocument();
    expect(screen.getByText('रू 2,500.00')).toBeInTheDocument();
  });

  it('searches for a customer and records a receipt', async () => {
    renderPayments();

    fireEvent.change(screen.getByLabelText('Search customer for receipt'), {
      target: { value: 'Sita' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Sita Rai 9800000000/i }));
    fireEvent.change(screen.getByLabelText('Amount (NPR)'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record receipt' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/payments/receipts'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Receipt recorded.')).toBeInTheDocument();
  });
});
