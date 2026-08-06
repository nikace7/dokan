import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomersPage } from '@/features/customers/CustomersPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      data,
      meta: Array.isArray(data)
        ? { count: data.length, page: 1, page_size: 25, total_pages: 1 }
        : null,
      error: null,
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function me(permissions: string[]) {
  return {
    id: 'user-1',
    phone: '9800000000',
    full_name: 'Shop User',
    email: null,
    must_change_password: false,
    is_owner: false,
    permissions,
    plan: { code: 'pro', name: 'Pro', features: {} },
  };
}

const customer = {
  id: 'customer-1',
  name: 'Sita Rai',
  phone: '9812345678',
  address: 'Kathmandu',
  default_rate_type: 'retail-1',
  credit_limit: '50000.00',
  opening_balance: '0.00',
  loyalty_points: '10.00',
  birthday_bs: null,
  gender: null,
  note: null,
  is_active: true,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CustomersPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('lists customers without exposing writes to a viewer', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) return Promise.resolve(envelope(me(['customer.view'])));
      if (url.includes('/v1/customers')) return Promise.resolve(envelope([customer]));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderPage();

    // Rows render in both the mobile card list and the desktop table.
    expect((await screen.findAllByText('Sita Rai')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('रू 50,000.00').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'New customer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('creates, edits, and deactivates a customer with credit permission', async () => {
    const customers = [{ ...customer }];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return envelope(
          me(['customer.view', 'customer.manage', 'customer.credit', 'pricing.view']),
        );
      }
      if (url.includes('/v1/pricing/rate-types')) {
        return envelope([
          {
            id: 'retail-1',
            code: 'retail',
            name: 'Retail',
            name_np: null,
            is_default: true,
            sort_order: 0,
            default_margin_pct: null,
            required_permission: null,
            is_active: true,
          },
        ]);
      }
      if (url.endsWith('/v1/customers') && init?.method === 'POST') {
        const created = {
          ...customer,
          id: 'customer-2',
          ...(JSON.parse(String(init.body)) as object),
        };
        customers.push(created);
        return envelope(created, 201);
      }
      if (url.endsWith('/v1/customers/customer-1') && init?.method === 'PATCH') {
        Object.assign(customers[0], JSON.parse(String(init.body)) as object);
        return envelope(customers[0]);
      }
      if (url.endsWith('/v1/customers/customer-1') && init?.method === 'DELETE') {
        customers[0].is_active = false;
        return envelope({ id: 'customer-1', is_active: false });
      }
      if (url.includes('/v1/customers')) return envelope(customers);
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'New customer' }));
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Hari Thapa' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9800000001' } });
    fireEvent.change(screen.getByLabelText('Credit limit'), { target: { value: '25000.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    expect((await screen.findAllByText('Hari Thapa')).length).toBeGreaterThan(0);

    // Scope to the desktop table row (the mobile card list renders the same row).
    const table = screen.getByRole('table');
    const row = within(table).getByText('Sita Rai').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'Pokhara' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/customers/customer-1'),
        expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('Pokhara') }),
      ),
    );

    fireEvent.click(within(row!).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/customers/customer-1'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
