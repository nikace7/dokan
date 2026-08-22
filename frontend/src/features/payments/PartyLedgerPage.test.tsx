import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PartyLedgerPage } from '@/features/payments/PartyLedgerPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function page(data: unknown[]): Response {
  return new Response(
    JSON.stringify({
      data,
      meta: { count: data.length, page: 1, total_pages: 1, page_size: 20 },
      error: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const customer = { id: 'customer-1', name: 'Sita Rai', phone: '9800000000' };
const supplier = { id: 'supplier-1', name: 'ABC Garments', phone: '9811111111' };

function renderPage(route = '/ledgers') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <PartyLedgerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PartyLedgerPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/customers/customer-1')) return envelope(customer);
      if (url.includes('/v1/customers?')) return envelope([customer]);
      if (url.endsWith('/v1/customers/customer-1/ledger')) {
        return envelope([
          {
            date: '2026-08-03',
            kind: 'SALE',
            ref: 'Bill 1001',
            debit: '2500.00',
            credit: '0.00',
            balance: '2500.00',
          },
          {
            date: '2026-08-03',
            kind: 'RECEIPT',
            ref: 'CASH receipt',
            debit: '0.00',
            credit: '500.00',
            balance: '2000.00',
          },
        ]);
      }
      if (url.includes('/v1/purchasing/suppliers?')) return page([supplier]);
      if (url.endsWith('/v1/purchasing/suppliers/supplier-1/ledger')) {
        return envelope([
          {
            date: '2026-08-03',
            kind: 'PURCHASE',
            ref: 'Bill 2001',
            debit: '4000.00',
            credit: '0.00',
            balance: '4000.00',
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('loads a customer ledger after selecting a customer', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Search customer ledger'), {
      target: { value: 'Sita' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Sita Rai 9800000000/i }));

    // Rows render in both the mobile card list and the desktop table.
    expect((await screen.findAllByText('Bill 1001')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('CASH receipt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('रू 2,000.00').length).toBeGreaterThan(0);
  });

  it('preselects the customer from the ?customer= query param', async () => {
    renderPage('/ledgers?customer=customer-1');

    // The customer tab stays active and the ledger loads without a search.
    expect(screen.getByRole('tab', { name: /Customer ledger/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('Sita Rai')).toBeInTheDocument();
    expect((await screen.findAllByText('Bill 1001')).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Search customer ledger')).not.toBeInTheDocument();
  });

  it('loads a supplier ledger from the supplier tab', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: /Supplier ledger/i }));
    fireEvent.change(screen.getByLabelText('Search supplier ledger'), {
      target: { value: 'ABC' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /ABC Garments 9811111111/i }));

    expect((await screen.findAllByText('Bill 2001')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('रू 4,000.00').length).toBeGreaterThan(0);
  });
});
