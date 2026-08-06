import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SalesReportPage } from '@/features/reports/SalesReportPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DAILY_ROWS = [
  {
    business_date_bs: '2083-04-14',
    bill_count: 3,
    subtotal: '1500.00',
    discount: '50.00',
    vat: '0.00',
    total: '1450.00',
    paid: '1450.00',
    due: '0.00',
    returns_count: 0,
    returns_total: '0.00',
    net_total: '1450.00',
  },
  {
    business_date_bs: '2083-04-15',
    bill_count: 5,
    subtotal: '2600.00',
    discount: '100.00',
    vat: '0.00',
    total: '2500.00',
    paid: '2000.00',
    due: '500.00',
    returns_count: 1,
    returns_total: '300.00',
    net_total: '2200.00',
  },
];

describe('SalesReportPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/reports/daily-sales')) {
        return Promise.resolve(envelope(DAILY_ROWS));
      }
      return Promise.reject(new Error(`Unexpected request: GET ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('renders daily rows with a paisa-summed totals row', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <SalesReportPage />
      </QueryClientProvider>,
    );

    // Both daily rows render (mobile card list + desktop table show the
    // same rows; scope to the desktop table for the structural checks).
    expect((await screen.findAllByText('2083-04-14')).length).toBeGreaterThan(0);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    const desktop = within(table as HTMLTableElement);
    expect(desktop.getByText('2083-04-14')).toBeInTheDocument();
    expect(desktop.getByText('2083-04-15')).toBeInTheDocument();

    // Totals row: bills 3+5=8, total 1450+2500=3,950.00, due 0+500=500.00,
    // net 1450+2200=3,650.00 (lakh/crore grouping, no symbol).
    // The tfoot totals row (the header also has a "Total" column).
    const totalsRow = container.querySelector('tfoot tr');
    expect(totalsRow).not.toBeNull();
    expect(totalsRow).toHaveTextContent('8');
    expect(totalsRow).toHaveTextContent('3,950.00');
    expect(totalsRow).toHaveTextContent('500.00');
    expect(totalsRow).toHaveTextContent('3,650.00');
    // Returns: the day with a credit note shows its amount in its own row.
    const returnsDay = desktop.getByText('2083-04-15').closest('tr');
    expect(returnsDay).toHaveTextContent('300.00');
    expect(totalsRow).toHaveTextContent('300.00');
  });
});
