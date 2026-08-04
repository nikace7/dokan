import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentsPage } from '@/features/payments/PaymentsPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

vi.mock('@/features/settings/useWorkspace', () => ({
  useWorkspace: () => ({
    branches: [{ id: 'branch-1', name: 'Main', is_default: true }],
    rateTypes: [{ id: 'rate-1', name: 'Retail', is_default: true }],
    branchId: 'branch-1',
    rateTypeId: 'rate-1',
    setBranchId: vi.fn(),
    setRateTypeId: vi.fn(),
    isReady: true,
    isLoading: false,
    error: null,
  }),
}));

const fetchMock = vi.fn<typeof fetch>();
let currentSession: Record<string, unknown> | null = null;

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

const supplier = {
  id: 'supplier-1',
  name: 'ABC Garments',
  phone: '9811111111',
  pan_no: null,
  address: null,
  opening_balance: '0.00',
  credit_days: 30,
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

const priorAllocationPayment = {
  ...payment,
  allocations: [
    {
      id: 'allocation-1',
      sales_invoice: 'invoice-1',
      purchase_invoice: null,
      amount: '1000.00',
    },
  ],
};

const allocationInvoice = {
  id: 'invoice-1',
  branch: 'branch-1',
  branch_code: 'MAIN',
  invoice_no: 1001,
  customer: customer.id,
  customer_name: customer.name,
  due_amount: '4000.00',
  status: 'COMPLETED',
  doc_type: 'SALE',
  business_date_bs: '2083-04-18',
};

describe('PaymentsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    currentSession = null;
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/cash-sessions/current?')) {
        return envelope({ session: currentSession });
      }
      if (url.endsWith('/v1/cash-sessions/open')) {
        currentSession = {
          id: 'session-1',
          branch: 'branch-1',
          branch_code: 'MAIN',
          opened_by: 'user-1',
          opened_by_name: 'Owner',
          opened_at: '2026-08-03T08:00:00Z',
          opening_float: '5000.00',
          closed_by: null,
          closed_at: null,
          counted_cash: null,
          expected_cash: null,
          variance: null,
          note: '',
        };
        return envelope(currentSession, 201);
      }
      if (url.includes('/v1/purchasing/suppliers?')) return page([supplier]);
      if (url.includes('/v1/sales?')) return page([allocationInvoice]);
      if (url.includes('customer=')) return page([priorAllocationPayment]);
      if (url.endsWith('/v1/payments/supplier-payments')) return envelope(payment, 201);
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
    fireEvent.change(screen.getAllByLabelText('Amount (NPR)')[0], { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record receipt' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/payments/receipts'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Receipt recorded.')).toBeInTheDocument();
  });

  it('allocates a customer receipt to an invoice', async () => {
    renderPayments();

    fireEvent.change(screen.getByLabelText('Search customer for receipt'), {
      target: { value: 'Sita' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Sita Rai 9800000000/i }));
    fireEvent.change(screen.getAllByLabelText('Amount (NPR)')[0], { target: { value: '2500' } });
    const allocation = await screen.findByLabelText('Allocation for invoice 1001');
    expect(allocation).toHaveAttribute('max', '3000.00');
    fireEvent.change(allocation, {
      target: { value: '2500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record receipt' }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([input]) =>
        String(input).endsWith('/v1/payments/receipts'),
      );
      expect(request).toBeDefined();
      expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
        allocations: [{ invoice: 'invoice-1', amount: '2500' }],
      });
    });
  });

  it('opens the cash session for the configured branch', async () => {
    renderPayments();

    fireEvent.change(await screen.findByLabelText('Opening float (NPR)'), {
      target: { value: '5000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }));

    expect(await screen.findByText('Cash session opened.')).toBeInTheDocument();
    expect(await screen.findByText('Owner')).toBeInTheDocument();
  });

  it('records a supplier payment', async () => {
    renderPayments();

    fireEvent.change(screen.getByLabelText('Search supplier for payment'), {
      target: { value: 'ABC' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /ABC Garments 9811111111/i }));
    fireEvent.change(screen.getAllByLabelText('Amount (NPR)')[1], {
      target: { value: '3000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record supplier payment' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/payments/supplier-payments'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Supplier payment recorded.')).toBeInTheDocument();
  });
});
