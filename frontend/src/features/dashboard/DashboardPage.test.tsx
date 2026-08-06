import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function me(permissions: string[], features: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    phone: '9800000000',
    full_name: 'Ram Sharma',
    email: null,
    must_change_password: false,
    is_owner: permissions.includes('report.profit'),
    permissions,
    plan: {
      code: 'pro',
      name: 'Pro',
      features: { profit_reports: true, advanced_pos: true, ...features },
    },
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('shows the owner summary, trend, shortcuts, and recent bills', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(
          response(
            me([
              'customer.view',
              'pricing.view_cost',
              'report.ledger',
              'report.profit',
              'report.sales',
              'sale.create',
              'sale.view',
              'stock.adjust',
              'stock.view',
            ]),
          ),
        );
      }
      if (url.includes('/v1/dashboard')) {
        return Promise.resolve(
          response({
            shop_name: 'Shree Ganesh Vastralaya',
            business_date_bs: '2083-04-20',
            sales: {
              today_total: '45200.00',
              bill_count: 18,
              last_30_days: [
                { business_date_bs: '2083-04-19', net_total: '30000.00' },
                { business_date_bs: '2083-04-20', net_total: '45200.00' },
              ],
            },
            profit: { today_net_profit: '11300.00' },
            dues: { total_receivable: '82500.00', customer_count: 23 },
            low_stock: { count: 14 },
            recent_bills: [
              {
                id: 'sale-1',
                invoice_no: 'INV-1042',
                customer_name: 'Sita Rai',
                total: '3400.00',
                tender_methods: ['CASH'],
                created_at: '2026-08-05T03:00:00Z',
              },
            ],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderPage();

    expect(await screen.findByText('Shree Ganesh Vastralaya')).toBeInTheDocument();
    expect(screen.getByText('रू 45,200')).toBeInTheDocument();
    expect(screen.getByText('रू 11,300')).toBeInTheDocument();
    expect(screen.getByText('23 customers')).toBeInTheDocument();
    expect(screen.getByLabelText('Last 30 days sales')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new bill/i })).toHaveAttribute('href', '/billing');
    expect(screen.getByText('INV-1042')).toBeInTheDocument();
  });

  it('keeps a cashier dashboard to two tiles and the billing shortcut', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(response(me(['sale.create', 'sale.view', 'stock.view'])));
      }
      if (url.includes('/v1/dashboard')) {
        return Promise.resolve(
          response({
            shop_name: 'Shree Ganesh Vastralaya',
            business_date_bs: '2083-04-20',
            sales: { today_total: '8000.00', bill_count: 4, last_30_days: [] },
            low_stock: { count: 2 },
            recent_bills: [],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderPage();

    expect(await screen.findByText('Today sales')).toBeInTheDocument();
    expect(screen.getByText('Low stock')).toBeInTheDocument();
    expect(screen.queryByText('Today profit')).not.toBeInTheDocument();
    expect(screen.queryByText('Receivables')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /new bill/i })).toBeInTheDocument();
  });

  it('shows sales and dues tiles but never the profit tile without cost authority', async () => {
    // Manager-style account: ledger + sales reports, but no report.profit /
    // pricing.view_cost — the server omits `profit` and the tile must not
    // render (invariant 10: cost data never leaks, not even as a label).
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(
          response(
            me(['customer.view', 'report.ledger', 'report.sales', 'sale.view', 'stock.view']),
          ),
        );
      }
      if (url.includes('/v1/dashboard')) {
        return Promise.resolve(
          response({
            shop_name: 'Shree Ganesh Vastralaya',
            business_date_bs: '2083-04-20',
            sales: {
              today_total: '12000.00',
              bill_count: 7,
              last_30_days: [{ business_date_bs: '2083-04-20', net_total: '12000.00' }],
            },
            dues: { total_receivable: '30000.00', customer_count: 5 },
            low_stock: { count: 3 },
            recent_bills: [],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderPage();

    expect(await screen.findByText('Today sales')).toBeInTheDocument();
    expect(screen.getByText('Receivables')).toBeInTheDocument();
    expect(screen.getByText('5 customers')).toBeInTheDocument();
    expect(screen.queryByText('Today profit')).not.toBeInTheDocument();
    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
    // Sales-report permission still surfaces the trend and reports shortcut.
    expect(screen.getByLabelText('Last 30 days sales')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reports/i })).toHaveAttribute('href', '/reports');
  });

  it('points New bill at the simple sale screen without advanced_pos', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(
          response(me(['sale.create', 'sale.view', 'stock.view'], { advanced_pos: false })),
        );
      }
      if (url.includes('/v1/dashboard')) {
        return Promise.resolve(
          response({
            shop_name: 'Shree Ganesh Vastralaya',
            business_date_bs: '2083-04-20',
            sales: { today_total: '8000.00', bill_count: 4, last_30_days: [] },
            low_stock: { count: 2 },
            recent_bills: [],
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderPage();

    const link = await screen.findByRole('link', { name: /new bill/i });
    expect(link).toHaveAttribute('href', '/billing/simple');
  });
});
