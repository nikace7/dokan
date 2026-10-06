import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillsPage } from '@/features/bills/BillsPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function page(data: unknown[], meta: { count: number; page: number; total_pages: number }) {
  return new Response(JSON.stringify({ data, meta: { ...meta, page_size: 25 }, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bill(overrides: Record<string, unknown>) {
  return {
    id: 'bill-1',
    doc_type: 'SALE',
    invoice_prefix: 'MAIN',
    invoice_no: 42,
    status: 'COMPLETED',
    customer_name: null,
    business_date_bs: '2083-06-10',
    total: '1500.00',
    due_amount: '0.00',
    tenders: [{ method: 'CASH', amount: '1500.00' }],
    ...overrides,
  };
}

function requestedUrl(call = -1): URL {
  return new URL(String(fetchMock.mock.calls.at(call)?.[0]), 'http://localhost');
}

function renderPage(entry = '/bills') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <BillsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BillsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('lists completed sales for the month with a count and links to each bill', async () => {
    fetchMock.mockResolvedValue(
      page(
        [
          bill({}),
          bill({
            id: 'bill-2',
            invoice_no: 43,
            customer_name: 'Ram Thapa',
            tenders: [],
            due_amount: '800.00',
          }),
        ],
        { count: 2, page: 1, total_pages: 1 },
      ),
    );

    renderPage();

    expect(await screen.findByText('2 bills')).toBeInTheDocument();
    const url = requestedUrl();
    expect(url.pathname).toMatch(/\/v1\/sales$/);
    expect(url.searchParams.get('status')).toBe('COMPLETED');
    expect(url.searchParams.get('doc_type')).toBe('SALE');
    expect(url.searchParams.get('date_from_bs')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(url.searchParams.has('invoice_no')).toBe(false);

    const links = screen.getAllByRole('link', { name: 'MAIN-43' });
    expect(links[0]).toHaveAttribute('href', '/bills/bill-2');
    expect(screen.getAllByText('Credit').length).toBeGreaterThan(0);
  });

  it('finds a bill by number across all dates', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(page([bill({})], { count: 1, page: 1, total_pages: 1 })),
    );
    renderPage();
    await screen.findByText('1 bill');

    fireEvent.change(screen.getByLabelText('Bill no.'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    await waitFor(() => expect(requestedUrl().searchParams.get('invoice_no')).toBe('42'));
    expect(requestedUrl().searchParams.has('date_from_bs')).toBe(false);
    expect(await screen.findByText('Showing bill no. 42 from any date.')).toBeInTheDocument();
  });

  it('rejects a non-numeric bill number without searching', async () => {
    fetchMock.mockResolvedValue(page([], { count: 0, page: 1, total_pages: 1 }));
    renderPage();
    expect(await screen.findByText('No bills match these filters.')).toBeInTheDocument();
    const calls = fetchMock.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Bill no.'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    expect(await screen.findByText('Enter a whole bill number.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('pages through bills and can show every status and type', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        page(
          [
            bill({}),
            bill({ id: 'bill-held', invoice_no: null, status: 'HELD' }),
            bill({ id: 'bill-void', invoice_no: null, status: 'CANCELLED' }),
          ],
          { count: 30, page: 1, total_pages: 2 },
        ),
      ),
    );
    renderPage('/bills?status=all&type=all');
    await screen.findByText('30 bills');
    // Unnumbered bills are named by what happened to them.
    expect(screen.getAllByText('Held bill (no number yet)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cancelled bill (never numbered)').length).toBeGreaterThan(0);
    expect(requestedUrl().searchParams.has('status')).toBe(false);
    expect(requestedUrl().searchParams.has('doc_type')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(requestedUrl().searchParams.get('page')).toBe('2'));
  });
});
