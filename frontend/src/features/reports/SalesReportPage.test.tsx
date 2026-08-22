import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SalesReportPage } from '@/features/reports/SalesReportPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';
import { adToBs, toBsString } from '@/lib/bs';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SalesReportPage />
    </QueryClientProvider>,
  );
}

/** BS today, computed the same way the reports api module computes it. */
function todayBs(): string {
  const todayAd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
  return toBsString(adToBs(todayAd));
}

function fetchedUrls(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
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
    const { container } = renderPage();

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

  it('quick-range chips fill the inputs and apply the range immediately', async () => {
    renderPage();
    await screen.findAllByText('2083-04-14');

    const fromInput = screen.getByLabelText('From (BS)') as HTMLInputElement;
    const toInput = screen.getByLabelText('To (BS)') as HTMLInputElement;
    const today = todayBs();

    // Today: single-day range, refetches with from=to.
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(fromInput.value).toBe(today);
    expect(toInput.value).toBe(today);
    await waitFor(() =>
      expect(
        fetchedUrls().some((url) => url.includes(`date_from_bs=${today}&date_to_bs=${today}`)),
      ).toBe(true),
    );

    // This month: month start → today.
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    const monthStart = `${today.slice(0, 8)}01`;
    expect(fromInput.value).toBe(monthStart);
    expect(toInput.value).toBe(today);
    await waitFor(() =>
      expect(
        fetchedUrls().some((url) => url.includes(`date_from_bs=${monthStart}&date_to_bs=${today}`)),
      ).toBe(true),
    );

    // Last month: 1st → last day of the previous BS month, fetched as entered.
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    expect(fromInput.value).toMatch(/^\d{4}-\d{2}-01$/);
    expect(fromInput.value < monthStart).toBe(true);
    expect(toInput.value >= fromInput.value).toBe(true);
    expect(toInput.value < monthStart).toBe(true);
    await waitFor(() =>
      expect(
        fetchedUrls().some((url) =>
          url.includes(`date_from_bs=${fromInput.value}&date_to_bs=${toInput.value}`),
        ),
      ).toBe(true),
    );
  });

  it('toggles the daily tab between table and chart views', async () => {
    const { container } = renderPage();
    await screen.findAllByText('2083-04-14');

    // Table is the default view.
    const tableButton = screen.getByRole('button', { name: 'Table' });
    const chartButton = screen.getByRole('button', { name: 'Chart' });
    expect(tableButton).toHaveAttribute('aria-pressed', 'true');
    expect(chartButton).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('table')).not.toBeNull();

    fireEvent.click(chartButton);
    expect(screen.getByRole('img', { name: 'Last 30 days sales' })).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
    expect(chartButton).toHaveAttribute('aria-pressed', 'true');
    expect(tableButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(tableButton);
    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'Last 30 days sales' })).not.toBeInTheDocument();
  });
});
