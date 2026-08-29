import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/layout/AppShell';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

let features: Record<string, unknown> = {};

/** Every codename the nav can check — the resolved set an owner gets. */
const OWNER_PERMISSIONS = [
  'sale.view',
  'sale.create',
  'sale.void',
  'sale.return',
  'catalog.view',
  'pricing.view',
  'stock.view',
  'stock.purchase',
  'customer.view',
  'expense.view',
  'payment.view',
  'payment.receive',
  'cash.manage',
  'report.sales',
  'report.staff',
  'report.stock',
  'report.profit',
  'report.ledger',
  'report.cash',
  'report.vat',
  'report.expense',
  'settings.manage',
  'user.manage',
];

function me(features: Record<string, unknown>, perms: string[] = OWNER_PERMISSIONS) {
  return {
    id: 'user-1',
    phone: '9800000000',
    full_name: 'Ram Sharma',
    email: null,
    must_change_password: false,
    is_owner: true,
    permissions: perms,
    plan: { code: 'pro', name: 'Pro', features },
    shop_name: 'Shree Ganesh Vastralaya',
    shop_name_np: null,
  };
}

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={null} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell billing nav', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: me(features), error: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    features = {};
    void i18n.changeLanguage('en');
  });

  it('points Billing at the classic POS with advanced_pos', async () => {
    features = { simple_sale: true, advanced_pos: true };
    renderShell();

    await screen.findAllByRole('link', { name: /billing/i });
    // The link re-mounts when /auth/me lands (its key is the target path),
    // so re-query instead of holding the first-render nodes.
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /billing/i });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link).toHaveAttribute('href', '/billing');
      }
    });
  });

  it('points Billing at the simple sale screen without advanced_pos', async () => {
    features = { simple_sale: true, advanced_pos: false };
    renderShell();

    await screen.findAllByRole('link', { name: /billing/i });
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /billing/i });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link).toHaveAttribute('href', '/billing/simple');
      }
    });
  });

  it('switches nav labels to Nepali from the language toggle', async () => {
    features = { simple_sale: true, advanced_pos: true };
    renderShell();

    await screen.findAllByRole('link', { name: /billing/i });
    // The toggle renders twice (sidebar + mobile header); either works.
    fireEvent.click(screen.getAllByRole('button', { name: 'ने' })[0]);

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'बिलिङ' }).length).toBeGreaterThan(0);
    });
    expect(i18n.language).toBe('ne');
  });

  it('shows the shop name up top and the product as a powered-by mark', async () => {
    features = { simple_sale: true, advanced_pos: true };
    renderShell();

    // Sidebar + mobile top bar both render the tenant's shop name.
    await waitFor(() => {
      expect(screen.getAllByText('Shree Ganesh Vastralaya').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Powered by mero-pasal.online')).toBeInTheDocument();
  });
});

describe('AppShell new-sale FAB', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: me(features), error: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    features = {};
    void i18n.changeLanguage('en');
  });

  it('renders the center FAB targeting the classic POS with advanced_pos', async () => {
    features = { simple_sale: true, advanced_pos: true };
    renderShell();

    const fab = await screen.findByRole('link', { name: 'New sale' });
    await waitFor(() => {
      expect(fab).toHaveAttribute('href', '/billing');
    });
  });

  it('renders the center FAB targeting simple sale without advanced_pos', async () => {
    features = { simple_sale: true, advanced_pos: false };
    renderShell();

    const fab = await screen.findByRole('link', { name: 'New sale' });
    await waitFor(() => {
      expect(fab).toHaveAttribute('href', '/billing/simple');
    });
  });
});

describe('AppShell permission-aware nav', () => {
  let perms: string[] = [];

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: me(features, perms), error: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    features = {};
    perms = [];
    void i18n.changeLanguage('en');
  });

  it('shows a cashier only the screens they can actually use', async () => {
    features = { simple_sale: true, advanced_pos: false };
    perms = ['sale.create', 'sale.view', 'stock.view', 'catalog.view'];
    renderShell();

    expect(await screen.findAllByRole('link', { name: 'Dashboard' })).not.toHaveLength(0);
    // Await a gated link too — Dashboard renders before /auth/me lands, so a
    // synchronous query here would race the permission fetch.
    expect(await screen.findAllByRole('link', { name: 'Billing' })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Stock' })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'Catalog' })).not.toHaveLength(0);

    for (const label of [
      'Pricing',
      'Customers',
      'Purchasing',
      'Expenses',
      'Payments',
      'Ledgers',
      'Returns',
      'Exchanges',
      'Reports',
      'Audit',
      'Settings',
    ]) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
    }
    // Transfers additionally need the multi_branch plan feature.
    expect(screen.queryByRole('link', { name: 'Transfers' })).not.toBeInTheDocument();
  });

  it('shows a reports-only role Dashboard + Reports and no new-sale FAB', async () => {
    perms = ['report.sales'];
    renderShell();

    expect(await screen.findAllByRole('link', { name: 'Dashboard' })).not.toHaveLength(0);
    // Awaited for the same reason as above — /auth/me must land first.
    expect(await screen.findAllByRole('link', { name: 'Reports' })).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    // No dead-end FAB for someone who cannot create sales.
    expect(screen.queryByRole('link', { name: 'New sale' })).not.toBeInTheDocument();
  });

  it('shows the full nav to an owner-role user', async () => {
    features = { simple_sale: true, advanced_pos: true, multi_branch: true };
    perms = OWNER_PERMISSIONS;
    renderShell();

    for (const label of [
      'Dashboard',
      'Billing',
      'Catalog',
      'Pricing',
      'Customers',
      'Purchasing',
      'Expenses',
      'Payments',
      'Ledgers',
      'Returns',
      'Exchanges',
      'Reports',
      'Audit',
      'Settings',
    ]) {
      expect(await screen.findAllByRole('link', { name: label })).not.toHaveLength(0);
    }
    expect(screen.getAllByRole('link', { name: 'Transfers' })).not.toHaveLength(0);
  });
});
