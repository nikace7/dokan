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

  it('says why a customer could not be deactivated', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(envelope(me(['customer.view', 'customer.manage'])));
      }
      if (init?.method === 'DELETE') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: null,
              error: { code: 'CUSTOMER_HAS_DUES', message: 'This customer still owes Rs 500.' },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url.includes('/v1/customers')) return Promise.resolve(envelope([customer]));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    renderPage();
    await screen.findAllByText('Sita Rai');
    const table = within(screen.getByRole('table'));
    fireEvent.click(table.getByRole('button', { name: 'Deactivate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This customer still owes Rs 500.');
  });

  it('opens the form over the list and keeps typed details on a tap outside', async () => {
    const other = { ...customer, id: 'customer-2', name: 'Hari Thapa', phone: '9800000001' };
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(envelope(me(['customer.view', 'customer.manage'])));
      }
      if (url.includes('/v1/customers')) return Promise.resolve(envelope([customer, other]));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    renderPage();
    await screen.findAllByText('Sita Rai');
    const [editSita, editHari] = within(screen.getByRole('table')).getAllByRole('button', {
      name: 'Edit',
    });
    const name = () => screen.getByLabelText('Customer name');

    fireEvent.click(editSita);
    const dialog = screen.getByRole('dialog', { name: 'Edit customer' });
    expect(within(dialog).getByLabelText('Customer name')).toHaveValue('Sita Rai');
    fireEvent.change(name(), { target: { value: 'Sita R.' } });
    // Radix starts watching for outside taps a tick after the dialog opens.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(name()).toHaveValue('Sita R.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(editHari);
    expect(name()).toHaveValue('Hari Thapa');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'New customer' }));
    expect(screen.getByRole('dialog', { name: 'New customer' })).toBeInTheDocument();
    expect(name()).toHaveValue('');
  });

  it('renders khata quick actions for an active customer', async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) return Promise.resolve(envelope(me(['customer.view'])));
      if (url.includes('/v1/customers')) return Promise.resolve(envelope([customer]));
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    renderPage();

    // Phone becomes a tel: link in both the mobile card and the desktop row.
    const callLinks = await screen.findAllByRole('link', { name: '9812345678' });
    expect(callLinks.length).toBeGreaterThan(0);
    for (const link of callLinks) {
      expect(link).toHaveAttribute('href', 'tel:9812345678');
    }

    // Khata shortcuts deep-link to the payments and ledger pages.
    const payLinks = screen.getAllByRole('link', { name: 'Receive payment' });
    expect(payLinks.length).toBeGreaterThan(0);
    for (const link of payLinks) {
      expect(link).toHaveAttribute('href', '/payments?customer=customer-1');
    }
    const ledgerLinks = screen.getAllByRole('link', { name: 'Ledger' });
    expect(ledgerLinks.length).toBeGreaterThan(0);
    for (const link of ledgerLinks) {
      expect(link).toHaveAttribute('href', '/ledgers?customer=customer-1');
    }
  });
});
