import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingPage } from '@/features/billing/BillingPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';
import { useCartStore } from '@/stores/cartStore';

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
const printMock = vi.fn();
let printCount = 0;

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const VARIANT = {
  id: 'var-1',
  sku: 'TS-BLK-M',
  barcode: '8901234567890',
  size: 'M',
  color: 'Black',
  color_hex: '#000000',
  mrp: '1500.00',
  is_active: true,
  item__name: 'T-Shirt',
  item__name_np: 'टीसर्ट',
  item__code: 'TS',
};

const INVOICE = {
  id: 'sale-1',
  tenant_name: 'Shree Ganesh',
  tenant_name_np: 'श्री गणेश',
  legal_name: 'Shree Ganesh Traders Pvt. Ltd.',
  pan_vat_no: '123456789',
  vat_registered: true,
  branch: 'branch-1',
  branch_code: 'MAIN',
  invoice_prefix: 'INV',
  branch_name: 'Main Outlet',
  branch_name_np: 'मुख्य शाखा',
  branch_address: 'New Road, Kathmandu',
  branch_phone: '01-5550000',
  invoice_no: 1,
  doc_type: 'SALE',
  status: 'COMPLETED',
  customer: null,
  customer_name: null,
  rate_type_code: 'RETAIL',
  subtotal: '1500.00',
  discount_amount: '0.00',
  taxable_amount: '1500.00',
  vat_amount: '0.00',
  round_off: '0.00',
  total: '1500.00',
  paid_amount: '1500.00',
  due_amount: '0.00',
  is_vat_bill: false,
  print_count: 0,
  tenders: [{ method: 'CASH', amount: '1500.00' }],
  datetime_ad: '2026-07-31T08:00:00+05:45',
  business_date_ad: '2026-07-31',
  business_date_bs: '2083-04-15',
  fiscal_year_bs: '2083-84',
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
      returned_qty: '0.000',
    },
  ],
};

/** Route mock responses by URL + method. */
function installApiMock(saleResponse: Response, vatModule = true, printResponse?: Response) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/v1/auth/me')) {
      return Promise.resolve(
        envelope({
          id: 'user-1',
          phone: '9800000000',
          full_name: 'Demo Owner',
          email: null,
          must_change_password: false,
          permissions: ['sale.create'],
          plan: {
            code: 'basic',
            name: 'Basic',
            features: { vat_module: vatModule },
          },
        }),
      );
    }
    if (url.includes('/v1/catalog/variants/lookup')) {
      return Promise.resolve(envelope(VARIANT));
    }
    if (url.includes('/v1/sales/held')) {
      return Promise.resolve(envelope([]));
    }
    if (url.endsWith('/api/v1/sales') && method === 'POST') {
      return Promise.resolve(saleResponse);
    }
    if (url.endsWith('/api/v1/sales/sale-1/print') && method === 'POST') {
      if (printResponse) return Promise.resolve(printResponse);
      printCount += 1;
      return Promise.resolve(envelope({ id: 'sale-1', print_count: printCount }));
    }
    return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
  });
}

function renderBilling() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BillingPage />
    </QueryClientProvider>,
  );
}

async function scanAndAdd(code: string) {
  const input = screen.getByLabelText(/scan barcode or type sku/i);
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  expect(await screen.findByText('T-Shirt — M / Black')).toBeInTheDocument();
}

describe('BillingPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'print').mockImplementation(printMock);
    printCount = 0;
    setTokens({ access: 'access-1', refresh: 'refresh-1' });
    useCartStore.getState().clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    printMock.mockReset();
    vi.restoreAllMocks();
    clearTokens();
    useCartStore.getState().clear();
  });

  it('scans an item, completes the sale, and shows the receipt', async () => {
    installApiMock(envelope(INVOICE, 201));
    renderBilling();

    await scanAndAdd('8901234567890');
    // Display-only client total: 1 × रू 1,500.00
    expect(screen.getAllByText('रू 1,500.00').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /complete sale/i }));

    expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();
    expect(screen.getByText(/2083-04-15/)).toBeInTheDocument();
    expect(screen.getByText('Shree Ganesh')).toBeInTheDocument();
    expect(screen.getByText(/PAN\/VAT: 123456789/)).toBeInTheDocument();
    // Completing a sale must never pop the print/PDF dialog on its own.
    expect(printMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /reprint/i }));
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /reprint/i }));
    await waitFor(() => expect(printMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/copy 2/i)).toBeInTheDocument();

    // The sale POST carried an Idempotency-Key and the scanned variant.
    const saleCall = fetchMock.mock.calls.find(([url, init]) => {
      return String(url).endsWith('/api/v1/sales') && (init?.method ?? 'GET') === 'POST';
    });
    expect(saleCall).toBeDefined();
    const [, init] = saleCall as [RequestInfo | URL, RequestInit];
    expect((init.headers as Headers).get('Idempotency-Key')).toBeTruthy();
    const body = JSON.parse(String(init.body)) as {
      branch: string;
      rate_type: string;
      lines: Array<{ variant: string; qty: string }>;
      payments: Array<{ method: string; amount: string }>;
    };
    expect(body.branch).toBe('branch-1');
    expect(body.rate_type).toBe('rate-1');
    expect(body.lines).toEqual([{ variant: 'var-1', qty: '1', discount: '0.00' }]);
    expect(body.payments).toEqual([{ method: 'CASH', amount: '1500.00' }]);

    // "New bill" resets back to an empty cart.
    fireEvent.click(screen.getByRole('button', { name: /new bill/i }));
    expect(await screen.findByText(/cart is empty/i)).toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('uses F9 to complete a ready bill without auto-printing', async () => {
    installApiMock(envelope(INVOICE, 201));
    renderBilling();

    await scanAndAdd('8901234567890');
    fireEvent.keyDown(window, { key: 'F9' });

    expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();
    expect(printMock).not.toHaveBeenCalled();
  });

  it('still opens the receipt when print-history recording fails', async () => {
    installApiMock(
      envelope(INVOICE, 201),
      true,
      new Response(
        JSON.stringify({
          data: null,
          error: { code: 'UNAVAILABLE', message: 'Print history unavailable.' },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    renderBilling();

    await scanAndAdd('8901234567890');
    fireEvent.click(screen.getByRole('button', { name: /complete sale/i }));

    // The receipt renders fine; only the explicit Reprint hits the failing
    // print-history endpoint, and the dialog still opens afterwards.
    expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reprint/i }));
    expect(await screen.findByText(/print history could not be saved/i)).toBeInTheDocument();
    expect(printMock).toHaveBeenCalledTimes(1);
  });

  it('shows the server error message verbatim when the sale is rejected', async () => {
    installApiMock(
      new Response(
        JSON.stringify({
          data: null,
          error: { code: 'STOCK_INSUFFICIENT', message: 'Insufficient stock for T-Shirt — M.' },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    renderBilling();

    await scanAndAdd('8901234567890');
    fireEvent.click(screen.getByRole('button', { name: /complete sale/i }));

    expect(await screen.findByText('Insufficient stock for T-Shirt — M.')).toBeInTheDocument();
    // No receipt; the cart survives so the counter can fix the bill.
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('hides the VAT bill option when the tenant plan disables VAT', async () => {
    installApiMock(envelope(INVOICE, 201), false);

    renderBilling();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/auth/me'),
        expect.anything(),
      ),
    );
    expect(screen.queryByRole('checkbox', { name: /vat bill/i })).not.toBeInTheDocument();
  });

  it('shows the non-blocking invoice plan warning after completion', async () => {
    const response = envelope(INVOICE, 201);
    response.headers.set('X-Plan-Usage-Warning', 'PLAN_USAGE_WARNING_80');
    response.headers.set('X-Plan-Usage', '8');
    response.headers.set('X-Plan-Limit', '10');
    installApiMock(response);
    renderBilling();

    await scanAndAdd('8901234567890');
    fireEvent.click(screen.getByRole('button', { name: /complete sale/i }));

    expect(await screen.findByText(/8 of 10 monthly bills/i)).toBeInTheDocument();
    expect(screen.getByText(/billing remains available/i)).toBeInTheDocument();
  });
});
