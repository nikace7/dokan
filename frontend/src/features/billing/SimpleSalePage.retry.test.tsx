import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SimpleSalePage } from '@/features/billing/SimpleSalePage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';
import { useSimpleSaleStore } from '@/stores/simpleSaleStore';

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

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ data: null, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

/** Route mock responses by URL + method; `saleResponse` is POST /v1/sales. */
function installApiMock(saleResponse: () => Promise<Response>) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/v1/auth/me')) {
      return Promise.resolve(
        envelope({
          id: 'user-1',
          phone: '9800000000',
          full_name: 'Demo Cashier',
          email: null,
          must_change_password: false,
          permissions: ['sale.create', 'sale.view'],
          plan: { code: 'basic', name: 'Basic', features: {} },
        }),
      );
    }
    if (url.includes('/v1/catalog/variants/for-sale')) {
      // Page envelope: list endpoints carry pagination meta.
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [TSHIRT],
            meta: { count: 1, page: 1, total_pages: 1, page_size: 50 },
            error: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/api/v1/sales') && method === 'POST') {
      return saleResponse();
    }
    return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SimpleSalePage />
    </QueryClientProvider>,
  );
}

/** Open the picker and choose an item by name. */
async function pickItem(name: string) {
  fireEvent.click(screen.getByRole('button', { name: /add item/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('button', { name: new RegExp(name) }));
}

function completeButton() {
  return screen.getByRole('button', { name: /Complete ·/ });
}

/** Every POST /v1/sales so far, as the server saw it. */
function salePosts() {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith('/api/v1/sales') && init?.method === 'POST')
    .map(([, init]) => ({
      key: (init?.headers as Headers).get('Idempotency-Key'),
      body: String(init?.body),
    }));
}

describe('SimpleSalePage when the server does not answer', () => {
  beforeEach(() => {
    useSimpleSaleStore.getState().clear();
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access-1', refresh: 'refresh-1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    vi.restoreAllMocks();
    clearTokens();
  });

  it.each([
    ['the reply is lost', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['the gateway times out', () => Promise.resolve(new Response('', { status: 504 }))],
  ])('locks the bill when %s and retries exactly the same sale', async (_, lostReply) => {
    const replies = [lostReply, () => Promise.resolve(envelope(INVOICE, 200))];
    installApiMock(() => (replies.shift() as () => Promise<Response>)());
    renderPage();
    await pickItem('T-Shirt');
    fireEvent.click(completeButton());

    expect(await screen.findByText(/did not confirm this bill/i)).toBeInTheDocument();
    // Nothing on the bill may change: the server may already hold it.
    expect(screen.getByRole('button', { name: /add item/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove t-shirt/i })).toBeDisabled();
    expect(screen.getByLabelText(/^price \(रू\)$/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'QR' })).toBeDisabled();
    expect(completeButton()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();
    const [first, second] = salePosts();
    expect(second).toEqual(first);
  });

  it('keeps the bill when the cashier looks at another screen', async () => {
    installApiMock(() => Promise.resolve(envelope(INVOICE, 201)));
    const { unmount } = renderPage();
    await pickItem('T-Shirt');
    unmount();
    renderPage();

    expect(screen.getByRole('region', { name: 'T-Shirt — M / Black' })).toBeInTheDocument();
  });

  it('unlocks the bill once the server gives a definite no', async () => {
    const replies = [
      () => Promise.resolve(new Response('', { status: 502 })),
      () => Promise.resolve(apiError(400, 'STOCK_INSUFFICIENT', 'Not enough stock.')),
    ];
    installApiMock(() => (replies.shift() as () => Promise<Response>)());
    renderPage();
    await pickItem('T-Shirt');
    fireEvent.click(completeButton());
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Not enough stock.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add item/i })).toBeEnabled();
    expect(completeButton()).toBeEnabled();
  });

  it('discards a locked bill only after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    installApiMock(() => Promise.resolve(new Response('', { status: 502 })));
    renderPage();
    await pickItem('T-Shirt');
    fireEvent.click(completeButton());
    const discard = await screen.findByRole('button', { name: /discard/i });

    fireEvent.click(discard);
    expect(screen.getByRole('region', { name: 'T-Shirt — M / Black' })).toBeInTheDocument();

    confirm.mockReturnValue(true);
    fireEvent.click(discard);
    expect(screen.queryByRole('region', { name: /T-Shirt/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add item/i })).toBeEnabled();
  });
});
