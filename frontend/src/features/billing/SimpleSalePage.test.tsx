import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SimpleSalePage } from '@/features/billing/SimpleSalePage';
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
const printMock = vi.fn();
const clipboardWriteText = vi.fn<(text: string) => Promise<void>>();

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
function installApiMock(saleResponse?: Response, forSaleRows: unknown[] = [TSHIRT, JEANS]) {
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
            data: forSaleRows,
            meta: { count: forSaleRows.length, page: 1, total_pages: 1, page_size: 50 },
            error: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.endsWith('/api/v1/sales') && method === 'POST') {
      return Promise.resolve(saleResponse ?? envelope(INVOICE, 201));
    }
    if (url.endsWith('/api/v1/sales/sale-1/print') && method === 'POST') {
      return Promise.resolve(envelope({ id: 'sale-1', print_count: 1 }));
    }
    if (url.endsWith('/api/v1/sales/sale-1/share') && method === 'POST') {
      return Promise.resolve(envelope({ share_token: 'tok-1', share_url_path: '/bill/tok-1' }));
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

describe('SimpleSalePage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'print').mockImplementation(printMock);
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });
    setTokens({ access: 'access-1', refresh: 'refresh-1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    printMock.mockReset();
    clipboardWriteText.mockReset();
    vi.restoreAllMocks();
    clearTokens();
  });

  it('adds and removes lines while totals update live', async () => {
    installApiMock();
    renderPage();

    await pickItem('T-Shirt');
    expect(screen.getByRole('region', { name: 'T-Shirt — M / Black' })).toBeInTheDocument();
    expect(completeButton()).toHaveTextContent('रू 1,500.00');

    await pickItem('Jeans');
    expect(screen.getByRole('region', { name: 'Jeans — 32 / Blue' })).toBeInTheDocument();
    expect(completeButton()).toHaveTextContent('रू 4,000.00');

    fireEvent.click(screen.getByRole('button', { name: /remove jeans/i }));
    expect(screen.queryByRole('region', { name: /Jeans/ })).not.toBeInTheDocument();
    expect(completeButton()).toHaveTextContent('रू 1,500.00');
  });

  it('shows item photos in the picker and line card, with a placeholder when null', async () => {
    installApiMock();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    const dialog = await screen.findByRole('dialog');

    // T-Shirt has a photo; Jeans falls back to the placeholder tile.
    const tshirtButton = await within(dialog).findByRole('button', { name: /T-Shirt/ });
    const thumb = within(tshirtButton).getByRole('img', { name: 'T-Shirt' });
    expect(thumb).toHaveAttribute('src', '/media/tenants/t1/items/tshirt.png');
    expect(thumb).toHaveAttribute('loading', 'lazy');
    expect(
      within(within(dialog).getByRole('button', { name: /Jeans/ })).queryByRole('img'),
    ).not.toBeInTheDocument();

    // The picked line keeps the thumbnail.
    fireEvent.click(tshirtButton);
    const line = screen.getByRole('region', { name: 'T-Shirt — M / Black' });
    expect(within(line).getByRole('img', { name: 'T-Shirt' })).toHaveAttribute(
      'src',
      '/media/tenants/t1/items/tshirt.png',
    );
  });

  it('shows a tappable quick-pick photo grid on load', async () => {
    installApiMock();
    renderPage();

    const grid = await screen.findByRole('region', { name: /quick pick/i });
    const tshirt = await within(grid).findByRole('button', { name: /T-Shirt/ });
    // Photo tiles carry the item image; Jeans falls back to the placeholder.
    expect(within(tshirt).getByRole('img', { name: 'T-Shirt' })).toHaveAttribute(
      'src',
      '/media/tenants/t1/items/tshirt.png',
    );
    expect(
      within(within(grid).getByRole('button', { name: /Jeans/ })).queryByRole('img'),
    ).not.toBeInTheDocument();

    // Tapping a tile adds the line straight away — no dialog opens.
    fireEvent.click(tshirt);
    expect(screen.getByRole('region', { name: 'T-Shirt — M / Black' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(completeButton()).toHaveTextContent('रू 1,500.00');
  });

  it('shows a hint when the branch has no stock yet', async () => {
    installApiMock(undefined, []);
    renderPage();

    expect(await screen.findByText(/no items in stock at this branch yet/i)).toBeInTheDocument();
    // The search dialog stays reachable from the dashed button.
    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
  });

  it('blocks submit when the price is outside the allowed range', async () => {
    installApiMock();
    renderPage();
    await pickItem('T-Shirt');

    const priceInput = screen.getByLabelText(/^price$/i);

    fireEvent.change(priceInput, { target: { value: '2000' } });
    expect(await screen.findByText(/^Max /)).toBeInTheDocument();
    expect(completeButton()).toBeDisabled();

    fireEvent.change(priceInput, { target: { value: '1000' } });
    expect(await screen.findByText(/^Min /)).toBeInTheDocument();
    expect(completeButton()).toBeDisabled();

    // Back inside the range the sale can go through again.
    fireEvent.change(priceInput, { target: { value: '1500' } });
    await waitFor(() => expect(completeButton()).toBeEnabled());
    expect(fetchMock.mock.calls.some(([, init]) => (init?.method ?? 'GET') === 'POST')).toBe(false);
  });

  it('sends explicit unit_price, one tender, and an Idempotency-Key', async () => {
    installApiMock();
    renderPage();
    await pickItem('T-Shirt');
    await pickItem('Jeans');

    const tshirtLine = screen.getByRole('region', { name: 'T-Shirt — M / Black' });
    fireEvent.change(within(tshirtLine).getByLabelText(/Qty/), { target: { value: '2' } });
    expect(completeButton()).toHaveTextContent('रू 5,500.00');

    fireEvent.click(screen.getByRole('button', { name: 'QR' }));
    fireEvent.click(completeButton());

    expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();

    const saleCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/v1/sales') && (init?.method ?? 'GET') === 'POST',
    );
    expect(saleCall).toBeDefined();
    const [, init] = saleCall as [RequestInfo | URL, RequestInit];
    expect((init.headers as Headers).get('Idempotency-Key')).toBeTruthy();
    const body = JSON.parse(String(init.body)) as {
      branch: string;
      rate_type: string;
      lines: Array<{ variant: string; qty: string; unit_price: string; discount: string }>;
      payments: Array<{ method: string; amount: string }>;
      is_vat_bill: boolean;
    };
    expect(body.branch).toBe('branch-1');
    expect(body.rate_type).toBe('rate-1');
    expect(body.lines).toEqual([
      { variant: 'var-1', qty: '2', unit_price: '1500.00', discount: '0.00' },
      { variant: 'var-2', qty: '1', unit_price: '2500.00', discount: '0.00' },
    ]);
    expect(body.payments).toEqual([{ method: 'QR', amount: '5500.00' }]);
    expect(body.is_vat_bill).toBe(false);
  });

  it('shows a friendly message when no cash session is open', async () => {
    installApiMock(apiError(409, 'CASH_SESSION_REQUIRED', 'Open a cash session first.'));
    renderPage();
    await pickItem('T-Shirt');
    fireEvent.click(completeButton());

    expect(await screen.findByText(/day is not open yet/i)).toBeInTheDocument();
    expect(screen.getByText(/owner\/manager/)).toBeInTheDocument();
    // The raw server message is not what the cashier sees.
    expect(screen.queryByText('Open a cash session first.')).not.toBeInTheDocument();
    // No receipt; the bill stays editable.
    expect(screen.getByRole('region', { name: 'T-Shirt — M / Black' })).toBeInTheDocument();
  });

  it('copies the public bill link from the share panel', async () => {
    installApiMock();
    renderPage();
    await pickItem('T-Shirt');
    fireEvent.click(completeButton());
    expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /share link/i }));

    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledTimes(1));
    expect(clipboardWriteText).toHaveBeenCalledWith(`${window.location.origin}/bill/tok-1`);
    // The WhatsApp deep link opens once the token exists.
    const whatsapp = screen.getByRole('link', { name: /whatsapp/i });
    expect(whatsapp).toHaveAttribute(
      'href',
      `https://wa.me/?text=${encodeURIComponent(`${window.location.origin}/bill/tok-1`)}`,
    );
  });
});
