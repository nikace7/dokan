import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnlineOrdersPage } from '@/features/storefrontOrders/OnlineOrdersPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    user: {
      permissions: ['sale.view', 'sale.create', 'sale.void'],
      plan: { features: { ecommerce: true, advanced_pos: true } },
    },
  }),
}));

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORDER = {
  id: 'order-1',
  number_text: 'ORD-000001',
  status: 'PLACED',
  fulfillment: 'PICKUP',
  payment_method: 'COD',
  payment_status: 'PENDING',
  address: null,
  note: '',
  currency: 'NPR',
  subtotal: '1800.00',
  total: '1800.00',
  offer_text: '',
  tracking_token: 'track-1',
  business_date_ad: '2026-09-03',
  business_date_bs: '2083-05-18',
  created_at: '2026-09-03T10:00:00Z',
  customer: { email: 'buyer@example.com', full_name: 'Sita Buyer', phone: '9812345678' },
  branch: { id: 'branch-1', name: 'Main' },
  sales_invoice: null,
  items: [{ name: 'Winter Coat', size: 'M', color: 'Black', unit_price: '1800.00', compare_at: null, qty: '1.000', line_total: '1800.00' }],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><OnlineOrdersPage /></MemoryRouter></QueryClientProvider>);
}

describe('OnlineOrdersPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('accepts a placed order into one linked held POS bill', async () => {
    let prepared = false;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/v1/storefront/manage/orders/order-1/prepare') && method === 'POST') {
        prepared = true;
        return Promise.resolve(envelope({ ...ORDER, status: 'CONFIRMED', sales_invoice: { id: 'sale-1', status: 'HELD', invoice_no: null } }));
      }
      if (url.includes('/v1/storefront/manage/orders')) {
        return Promise.resolve(envelope(prepared ? [{ ...ORDER, status: 'CONFIRMED', sales_invoice: { id: 'sale-1', status: 'HELD', invoice_no: null } }] : [ORDER]));
      }
      return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    });

    renderPage();
    expect(await screen.findByText('ORD-000001')).toBeInTheDocument();
    expect(screen.getByText(/Sita Buyer/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare in POS' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/order-1/prepare') && init?.method === 'POST')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Open held bill' })).toBeInTheDocument();
  });
});
