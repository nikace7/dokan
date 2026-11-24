import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingPage } from '@/features/billing/BillingPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';
import { useCartStore } from '@/stores/cartStore';

const workspace = vi.hoisted(() => ({ rateTypeId: 'rate-1' }));
vi.mock('@/features/settings/useWorkspace', () => ({
  useWorkspace: () => ({
    branches: [],
    rateTypes: [],
    branchId: 'branch-1',
    rateTypeId: workspace.rateTypeId,
    isReady: true,
    isLoading: false,
  }),
}));

const fetchMock = vi.fn<typeof fetch>();
const reply = (data: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify({ data, error: null }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
const refusal = (code: string, message: string) =>
  Promise.resolve(
    new Response(JSON.stringify({ data: null, error: { code, message } }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

const VARIANT = {
  id: 'var-1',
  sku: 'TS-BLK-M',
  barcode: '8901234567890',
  size: 'M',
  color: 'Black',
  color_hex: '#000000',
  mrp: '1010.00',
  is_active: true,
  item__name: 'T-Shirt',
  item__name_np: 'टीसर्ट',
  item__code: 'TS',
};

const INVOICE = {
  id: 'sale-1',
  tenant_name: 'Shree Ganesh',
  branch_name: 'Main Outlet',
  invoice_prefix: 'INV',
  invoice_no: 1,
  doc_type: 'SALE',
  status: 'COMPLETED',
  subtotal: '700.00',
  discount_amount: '0.00',
  taxable_amount: '700.00',
  vat_amount: '0.00',
  round_off: '0.00',
  total: '700.00',
  paid_amount: '700.00',
  due_amount: '0.00',
  is_vat_bill: false,
  print_count: 0,
  tenders: [{ method: 'CASH', amount: '700.00' }],
  business_date_ad: '2026-07-31',
  business_date_bs: '2083-04-15',
  fiscal_year_bs: '2083-84',
  items: [],
};

/** The lookup answers with the price of the rate it is asked for. */
let prices: Record<string, string>;

function route(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://shop.test');
  const path = url.pathname;
  if (path.endsWith('/auth/me')) return reply({ permissions: ['sale.create'], plan: null });
  if (path.endsWith('/sales/held')) return reply([]);
  if (path.endsWith('/sales/hold')) return reply({ ...INVOICE, status: 'HELD' }, 201);
  if (path.endsWith('/sales') || path.endsWith('/complete')) return reply(INVOICE, 201);
  if (path.endsWith('/lookup')) {
    const price = prices[url.searchParams.get('rate_type') ?? ''];
    return price ? reply({ ...VARIANT, price }) : refusal('PRICE_NOT_SET', 'No price.');
  }
  return Promise.reject(new Error(`Unexpected request: ${path}`));
}

function renderBilling() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } })
      }
    >
      <MemoryRouter>
        <BillingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function scan() {
  const input = screen.getByLabelText(/scan barcode or type sku/i);
  fireEvent.change(input, { target: { value: VARIANT.barcode } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  await screen.findAllByText('T-Shirt — M / Black');
}

const completeButton = () => screen.getByRole('button', { name: /complete sale/i });
const cashField = () => screen.getByLabelText(/cash received/i);
const sentBody = (path: string) => {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => String(url).endsWith(path) && init?.method === 'POST',
  );
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
};

describe('BillingPage counter payment', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset().mockImplementation(route);
    prices = { 'rate-1': '700.00', 'rate-2': '600.00' };
    workspace.rateTypeId = 'rate-1';
    setTokens({ access: 'access-1', refresh: 'refresh-1' });
    useCartStore.getState().clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
    useCartStore.getState().clear();
  });

  it('bills the price of the selected rate, not the MRP', async () => {
    renderBilling();
    await scan();
    fireEvent.click(completeButton());

    expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();
    expect(sentBody('/sales').payments).toEqual([{ method: 'CASH', amount: '700.00' }]);
  });

  it('links to the cash drawer when a sale fails because it is closed', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/auth/me'))
        return reply({ id: 'user-1', permissions: ['sale.create', 'cash.manage'] });
      if (url.endsWith('/sales')) return refusal('CASH_SESSION_REQUIRED', 'Drawer is closed.');
      return route(input);
    });
    renderBilling();
    await scan();
    fireEvent.click(completeButton());

    expect(await screen.findByRole('link', { name: 'Open cash session' })).toHaveAttribute(
      'href',
      '/payments',
    );
  });

  it('keeps the change on screen after the sale is done', async () => {
    renderBilling();
    await scan();
    fireEvent.change(cashField(), { target: { value: '1000' } });
    fireEvent.keyDown(window, { key: 'F9' });

    expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();
    expect(screen.getByText(/change to return/i)).toHaveTextContent('रू 300.00');
    expect(sentBody('/sales').payments).toEqual([{ method: 'CASH', amount: '700.00' }]);
  });

  it('starts the next bill with an empty amount after parking one', async () => {
    renderBilling();
    await scan();
    fireEvent.change(cashField(), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /park this bill/i }));

    expect(await screen.findByText(/cart is empty/i)).toBeInTheDocument();
    expect(cashField()).toHaveValue('');
  });

  it('will not park a bill whose discount is wrong', async () => {
    renderBilling();
    await scan();
    fireEvent.change(screen.getByLabelText(/^discount for/i), { target: { value: '99999' } });
    fireEvent.click(screen.getByRole('button', { name: /park this bill/i }));

    expect(await screen.findByText(/fix the discount/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sales/hold'))).toBe(false);
  });

  it('locks the bill while it is being parked, so nothing scanned now is lost', async () => {
    fetchMock.mockImplementation((input) =>
      String(input).endsWith('/sales/hold') ? new Promise(() => undefined) : route(input),
    );
    renderBilling();
    await scan();
    fireEvent.click(screen.getByRole('button', { name: /park this bill/i }));

    expect(await screen.findByText(/parking/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scan barcode or type sku/i)).toBeDisabled();
    expect(completeButton()).toBeDisabled();
  });

  it('reprices the bill when the rate is changed', async () => {
    const { unmount } = renderBilling();
    await scan();
    unmount();
    workspace.rateTypeId = 'rate-2';
    renderBilling();

    expect((await screen.findAllByText('रू 600.00')).length).toBeGreaterThan(0);
    fireEvent.click(completeButton());
    expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();
    expect(sentBody('/sales').payments).toEqual([{ method: 'CASH', amount: '600.00' }]);
  });

  it('blocks the sale with a reason and a retry when the new rate has no price', async () => {
    const { unmount } = renderBilling();
    await scan();
    unmount();
    workspace.rateTypeId = 'rate-3';
    renderBilling();

    expect(await screen.findByText('No price.')).toBeInTheDocument();
    expect(completeButton()).toBeDisabled();

    prices['rate-3'] = '650.00';
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect((await screen.findAllByText('रू 650.00')).length).toBeGreaterThan(0);
    expect(completeButton()).toBeEnabled();
  });

  describe('with a held bill open', () => {
    beforeEach(() => {
      useCartStore.getState().resumeHeld(
        'held-1',
        [
          {
            variantId: 'var-1',
            sku: 'TS-BLK-M',
            label: 'T-Shirt',
            quantity: 1,
            unitPricePaisa: 70_000,
            discountPaisa: 0,
          },
        ],
        null,
        70_000,
      );
    });

    it('sends the customer picked at payment', async () => {
      useCartStore.getState().setCustomer({ id: 'c-1', name: 'Sita', phone: '98' });
      renderBilling();
      fireEvent.change(cashField(), { target: { value: '500' } });
      fireEvent.click(completeButton());

      expect(await screen.findByText('Invoice INV-1')).toBeInTheDocument();
      expect(sentBody('/sales/held-1/complete')).toEqual({
        payments: [{ method: 'CASH', amount: '500.00' }],
        customer: 'c-1',
      });
    });

    it('locks the items, because the server keeps what was parked', () => {
      renderBilling();
      expect(screen.getByText(/items cannot be changed/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/scan barcode or type sku/i)).toBeDisabled();
      expect(screen.getByLabelText(/^discount for/i)).toBeDisabled();
      expect(completeButton()).toBeEnabled();
    });

    it('can be put back without completing it', () => {
      renderBilling();
      fireEvent.click(screen.getByRole('button', { name: /leave it parked/i }));
      expect(useCartStore.getState().heldSaleId).toBeNull();
      expect(screen.getByText(/cart is empty/i)).toBeInTheDocument();
    });
  });
});
