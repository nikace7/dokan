import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PurchasingPage } from '@/features/purchasing/PurchasingPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, meta?: object, status = 200): Response {
  return new Response(JSON.stringify({ data, meta: meta ?? null, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PAGE_META = { count: 1, page: 1, total_pages: 1, page_size: 25 };

const DRAFT_INVOICE = {
  id: 'pi-1',
  branch: 'branch-1',
  branch_code: 'MAIN',
  supplier: 'sup-1',
  supplier_name: 'KTM Textiles',
  invoice_no: 'PI-2083-0001',
  supplier_bill_no: null,
  bill_date_ad: '2026-07-31',
  bill_date_bs: '2083-04-15',
  fiscal_year_bs: '2083-84',
  subtotal: '9000.00',
  discount: '0.00',
  taxable_amount: '9000.00',
  vat_amount: '0.00',
  other_charges: '0.00',
  total: '9000.00',
  paid_amount: '0.00',
  due_amount: '9000.00',
  status: 'DRAFT',
  is_vat_bill: false,
  note: '',
  created_at: '2026-07-31T08:00:00+05:45',
  items: [
    {
      id: 'pil-1',
      variant: 'var-1',
      variant_sku: 'TS-M-BLACK',
      item_name: 'T-Shirt',
      qty: '20.000',
      unit_cost: '450.00',
      discount: '0.00',
      line_total: '9000.00',
    },
  ],
};

const SUPPLIER = {
  id: 'sup-1',
  name: 'KTM Textiles',
  phone: null,
  pan_no: null,
  address: null,
  opening_balance: '0.00',
  credit_days: null,
  is_active: true,
};

function renderPurchasing() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PurchasingPage />
    </QueryClientProvider>,
  );
}

describe('PurchasingPage draft → confirm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('expands a draft, explains the irreversible confirm, and posts it', async () => {
    let confirmed = false;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/v1/purchasing/suppliers')) {
        return Promise.resolve(envelope([SUPPLIER], PAGE_META));
      }
      if (url.endsWith('/v1/purchasing/invoices/pi-1/confirm') && method === 'POST') {
        confirmed = true;
        return Promise.resolve(envelope({ ...DRAFT_INVOICE, status: 'CONFIRMED' }));
      }
      if (url.includes('/v1/purchasing/invoices')) {
        return Promise.resolve(
          envelope([{ ...DRAFT_INVOICE, status: confirmed ? 'CONFIRMED' : 'DRAFT' }], PAGE_META),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    });

    renderPurchasing();

    // Invoice list renders with the DRAFT badge; expand the row.
    expect(await screen.findByText('PI-2083-0001')).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /PI-2083-0001/ });
    // The status filter also lists these words — scope badge checks to the row.
    expect(within(row).getByText('Draft')).toBeInTheDocument();
    fireEvent.click(row);

    // Lines render; the guarded confirm explains what it does.
    expect(screen.getByText('T-Shirt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm — post stock/i }));
    expect(screen.getByText(/posts the stock into the ledger/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /yes, confirm/i }));

    await waitFor(() => {
      const confirmCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/v1/purchasing/invoices/pi-1/confirm') &&
          (init?.method ?? 'GET') === 'POST',
      );
      expect(confirmCall).toBeDefined();
    });

    // After invalidation the refetched list shows the confirmed badge.
    expect(await within(row).findByText('Confirmed')).toBeInTheDocument();
    expect(within(row).queryByText('Draft')).not.toBeInTheDocument();
  });
});

function mockPurchasing({
  invoices = [DRAFT_INVOICE],
  suppliers = [SUPPLIER],
}: { invoices?: object[]; suppliers?: object[] } = {}) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/v1/purchasing/suppliers')) {
      return Promise.resolve(envelope(suppliers, PAGE_META));
    }
    if (url.includes('/v1/purchasing/invoices')) {
      return Promise.resolve(envelope(invoices, { ...PAGE_META, count: invoices.length }));
    }
    return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
  });
}

describe('PurchasingPage status stepper', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('marks Draft current and Confirmed future on a draft invoice', async () => {
    mockPurchasing();
    renderPurchasing();
    const row = await screen.findByRole('button', { name: /PI-2083-0001/ });
    fireEvent.click(row);

    const stepper = screen.getByRole('list', { name: /invoice progress/i });
    const steps = within(stepper).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent('Draft');
    expect(steps[0]).toHaveAttribute('data-state', 'current');
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toHaveTextContent('Confirmed');
    expect(steps[1]).toHaveAttribute('data-state', 'future');
    expect(steps[1]).not.toHaveAttribute('aria-current');
  });

  it('marks both steps done on a confirmed invoice', async () => {
    mockPurchasing({ invoices: [{ ...DRAFT_INVOICE, status: 'CONFIRMED' }] });
    renderPurchasing();
    const row = await screen.findByRole('button', { name: /PI-2083-0001/ });
    fireEvent.click(row);

    const stepper = screen.getByRole('list', { name: /invoice progress/i });
    const steps = within(stepper).getAllByRole('listitem');
    expect(steps[0]).toHaveAttribute('data-state', 'done');
    expect(steps[1]).toHaveAttribute('data-state', 'done');
    expect(steps[0]).not.toHaveAttribute('aria-current');
    expect(steps[1]).not.toHaveAttribute('aria-current');
  });

  it('shows only the status badge for a cancelled invoice', async () => {
    mockPurchasing({ invoices: [{ ...DRAFT_INVOICE, status: 'CANCELLED' }] });
    renderPurchasing();
    const row = await screen.findByRole('button', { name: /PI-2083-0001/ });
    fireEvent.click(row);

    expect(screen.queryByRole('list', { name: /invoice progress/i })).not.toBeInTheDocument();
    // Row badge + the badge inside the expanded detail.
    const wrapper = row.parentElement as HTMLElement;
    expect(within(wrapper).getAllByText('Cancelled')).toHaveLength(2);
  });
});

describe('PurchasingPage supplier phone links', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('links a supplier phone number with tel:', async () => {
    mockPurchasing({ suppliers: [{ ...SUPPLIER, phone: '9800000001' }] });
    renderPurchasing();

    // Mobile card list + desktop table both render the link.
    const links = await screen.findAllByRole('link', { name: 'Call KTM Textiles' });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'tel:9800000001');
    }
  });

  it('renders no link when the supplier has no phone', async () => {
    mockPurchasing();
    renderPurchasing();

    await screen.findAllByText('KTM Textiles');
    expect(screen.queryByRole('link', { name: /call/i })).not.toBeInTheDocument();
  });
});
