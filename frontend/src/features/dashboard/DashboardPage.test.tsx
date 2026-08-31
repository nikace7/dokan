import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardPage } from '@/features/dashboard/DashboardPage';
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

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pagedResponse(rows: unknown[]): Response {
  return new Response(
    JSON.stringify({
      data: rows,
      error: null,
      meta: { count: rows.length, page: 1, total_pages: 1, page_size: 50 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
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

const COLLECTIONS = {
  date_from_bs: '2083-04-01',
  date_to_bs: '2083-04-20',
  methods: [
    { method: 'CASH', amount: '30000.00', count: 10 },
    { method: 'ESEWA', amount: '15200.00', count: 8 },
  ],
  total: '45200.00',
};

const OWNER_DASHBOARD = {
  shop_name: 'Shree Ganesh Vastralaya',
  business_date_bs: '2083-04-20',
  sales: {
    today_total: '45200.00',
    bill_count: 18,
    month_start_bs: '2083-04-01',
    month_to_date_total: '91200.00',
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
};

const LOW_STOCK_ROWS = [
  {
    variant_id: 'variant-1',
    sku: 'TEE-BLK-M',
    item_name: 'Cotton Tee',
    branch_id: 'branch-1',
    qty_on_hand: '2',
    reorder_level: '5',
  },
  {
    variant_id: 'variant-2',
    sku: 'JNS-BLU-32',
    item_name: 'Slim Jeans',
    branch_id: 'branch-1',
    qty_on_hand: '0',
    reorder_level: '3',
  },
];

function installMock(
  user: ReturnType<typeof me>,
  dashboard: unknown,
  collections?: unknown,
  lowStock: unknown[] = LOW_STOCK_ROWS,
) {
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/v1/auth/me')) {
      return Promise.resolve(response(user));
    }
    if (url.includes('/v1/reports/collections-by-tender')) {
      return Promise.resolve(response(collections ?? COLLECTIONS));
    }
    if (url.includes('/v1/reports/low-stock')) {
      return Promise.resolve(pagedResponse(lowStock));
    }
    if (url.includes('/v1/dashboard')) {
      return Promise.resolve(response(dashboard));
    }
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
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

  it('shows the owner home: greeting, tiles with trend, charts, donut, and recent bills', async () => {
    installMock(
      me([
        'customer.view',
        'pricing.view_cost',
        'report.ledger',
        'report.profit',
        'report.sales',
        'report.stock',
        'sale.create',
        'sale.view',
        'stock.adjust',
        'stock.view',
      ]),
      OWNER_DASHBOARD,
    );

    renderPage();

    expect(await screen.findByText('Hello, Ram Sharma')).toBeInTheDocument();
    expect(screen.getByText(/Shree Ganesh Vastralaya · Main · BS 2083-04-20/)).toBeInTheDocument();

    expect(screen.getByText("Today's collection")).toBeInTheDocument();
    expect(screen.getByText('रू 45,200.00')).toBeInTheDocument();
    expect(screen.getByText('18 bills')).toBeInTheDocument();
    expect(screen.getByText('Bills today')).toBeInTheDocument();
    expect(screen.getByText('Dues outstanding')).toBeInTheDocument();
    expect(screen.getByText('रू 82,500.00')).toBeInTheDocument();
    expect(screen.getByText('Low stock')).toBeInTheDocument();

    expect(screen.getByText(/50\.7%/)).toBeInTheDocument();
    expect(screen.getByText('vs yesterday')).toBeInTheDocument();

    expect(screen.getByText('Sales this month (BS)')).toBeInTheDocument();
    expect(screen.getByText('रू 91,200.00')).toBeInTheDocument();
    expect(screen.getByText('Since BS 2083-04-01')).toBeInTheDocument();
    expect(screen.getByText("Today's profit")).toBeInTheDocument();
    expect(screen.getByText('रू 11,300.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sales this month/ })).toHaveAttribute(
      'href',
      '/reports/sales',
    );
    expect(screen.getByRole('link', { name: /Today's profit/ })).toHaveAttribute(
      'href',
      '/reports/profit',
    );

    expect(screen.getByRole('link', { name: /Today's collection/ })).toHaveAttribute(
      'href',
      '/reports/sales',
    );
    expect(screen.getByRole('link', { name: /Bills today/ })).toHaveAttribute(
      'href',
      '/reports/sales',
    );
    expect(screen.getByRole('link', { name: /Dues outstanding/ })).toHaveAttribute(
      'href',
      '/reports/dues',
    );
    expect(screen.getByRole('link', { name: /Low stock/ })).toHaveAttribute(
      'href',
      '/reports/stock',
    );

    expect(screen.getByText(/14 items/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /TEE-BLK-M/ })).toHaveAttribute(
      'href',
      '/reports/stock',
    );
    expect(screen.getByRole('link', { name: /JNS-BLU-32/ })).toHaveAttribute(
      'href',
      '/reports/stock',
    );
    expect(screen.getByText('2 left')).toHaveClass('bg-warning');
    expect(screen.getByText('0 left')).toHaveClass('bg-destructive');
    expect(screen.getByText('reorder at 5')).toBeInTheDocument();
    expect(screen.getByText('reorder at 3')).toBeInTheDocument();

    expect(screen.getByLabelText('Last 30 days sales')).toBeInTheDocument();
    expect(await screen.findByText('Collection by method')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /CASH 66\.4%/ })).toBeInTheDocument();
    expect(screen.getByText('ESEWA')).toBeInTheDocument();
    expect(screen.getByText('रू 45,200')).toBeInTheDocument();

    expect(screen.getAllByRole('link', { name: 'New sale' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'New sale' })[0]).toHaveAttribute(
      'href',
      '/billing',
    );
    expect(screen.getByRole('link', { name: 'Stock' })).toHaveAttribute('href', '/stock');
    expect(screen.getAllByRole('link', { name: 'Reports' })).not.toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute('href', '/customers');

    expect(screen.getByText('INV-1042')).toBeInTheDocument();
    expect(screen.getByText('Sita Rai')).toBeInTheDocument();
    expect(screen.getAllByText('CASH').length).toBeGreaterThan(1);
  });

  it('keeps a cashier home minimal: no sales figures, bills, donut, or reports shortcuts', async () => {
    // The server omits the entire sales/recent-bills sections without
    // report.sales — staff never see collections, bill counts, or bills.
    installMock(me(['sale.create', 'sale.view', 'stock.view']), {
      shop_name: 'Shree Ganesh Vastralaya',
      business_date_bs: '2083-04-20',
      low_stock: { count: 2 },
    });

    renderPage();

    expect(await screen.findByText('Low stock')).toBeInTheDocument();
    expect(screen.queryByText('Bills today')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent bills')).not.toBeInTheDocument();
    expect(screen.queryByText("Today's collection")).not.toBeInTheDocument();
    expect(screen.queryByText('Sales this month (BS)')).not.toBeInTheDocument();
    expect(screen.queryByText("Today's profit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Last 30 days sales')).not.toBeInTheDocument();
    expect(screen.queryByText('Dues outstanding')).not.toBeInTheDocument();
    expect(screen.queryByText('Collection by method')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Stock' })).not.toBeInTheDocument();
    // New sale is the one surviving shortcut (header + grid).
    expect(screen.getAllByRole('link', { name: 'New sale' }).length).toBeGreaterThan(0);
    // The collections endpoint is never hit without report.sales.
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/v1/reports/collections-by-tender'),
      ),
    ).toBe(false);
    // Nor is the low-stock report — the preview strip needs report.stock.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/reports/low-stock')),
    ).toBe(false);
  });

  it('omits the low-stock strip when the summary has no low-stock section', async () => {
    installMock(me(['sale.create', 'sale.view', 'stock.view', 'report.stock']), {
      shop_name: 'Shree Ganesh Vastralaya',
      business_date_bs: '2083-04-20',
      sales: { bill_count: 4 },
      recent_bills: [],
    });

    renderPage();

    expect(await screen.findByText('Bills today')).toBeInTheDocument();
    expect(screen.queryByText('Low stock')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/reports/low-stock')),
    ).toBe(false);
  });

  it('omits the low-stock strip when the count is zero', async () => {
    installMock(me(['sale.create', 'sale.view', 'stock.view', 'report.stock']), {
      shop_name: 'Shree Ganesh Vastralaya',
      business_date_bs: '2083-04-20',
      sales: { bill_count: 4 },
      low_stock: { count: 0 },
      recent_bills: [],
    });

    renderPage();

    // The tile still renders, but no strip and no low-stock fetch.
    expect(await screen.findByText('Low stock')).toBeInTheDocument();
    expect(screen.queryByText(/0 items/)).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/reports/low-stock')),
    ).toBe(false);
  });

  it('shows sales and dues but never cost data without report.profit', async () => {
    // Manager-style account: ledger + sales reports, but no report.profit /
    // pricing.view_cost — the server omits `profit` and nothing cost-related
    // may render (invariant 10).
    installMock(me(['customer.view', 'report.ledger', 'report.sales', 'sale.view', 'stock.view']), {
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
    });

    renderPage();

    expect(await screen.findByText('Dues outstanding')).toBeInTheDocument();
    expect(screen.getByText('5 customers')).toBeInTheDocument();
    expect(screen.queryByText(/profit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
    // report.sales surfaces the donut.
    expect(await screen.findByText('Collection by method')).toBeInTheDocument();
    // A single-day series yields no yesterday trend — nothing invented.
    expect(screen.queryByText('vs yesterday')).not.toBeInTheDocument();
  });

  it('points New sale at the simple sale screen without advanced_pos', async () => {
    installMock(me(['sale.create', 'sale.view', 'stock.view'], { advanced_pos: false }), {
      shop_name: 'Shree Ganesh Vastralaya',
      business_date_bs: '2083-04-20',
      sales: { today_total: '8000.00', bill_count: 4, last_30_days: [] },
      low_stock: { count: 2 },
      recent_bills: [],
    });

    renderPage();

    const links = await screen.findAllByRole('link', { name: 'New sale' });
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/billing/simple');
    }
  });

  it('shows an empty state with a New sale action for a shop with no sales today', async () => {
    installMock(me(['sale.create', 'sale.view', 'stock.view']), {
      shop_name: 'Shree Ganesh Vastralaya',
      business_date_bs: '2083-04-20',
      sales: { today_total: '0.00', bill_count: 0, last_30_days: [] },
      recent_bills: [],
    });

    renderPage();

    expect(await screen.findByText('No sales yet today')).toBeInTheDocument();
    expect(screen.getByText('Ring up the first sale to start the day.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New sale' })).toBeInTheDocument();
  });
});
