import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfitReportPage } from '@/features/reports/ProfitReportPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderProfit() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfitReportPage />
    </QueryClientProvider>,
  );
}

describe('ProfitReportPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('shows a friendly owner-only panel on 403 instead of an error dump', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: null,
          error: {
            code: 'COST_VISIBILITY_REQUIRED',
            message: 'Profit reports require cost visibility.',
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderProfit();

    expect(await screen.findByText('Owner only')).toBeInTheDocument();
    expect(screen.getByText(/only available to accounts with the profit/)).toBeInTheDocument();
    // The raw server message is NOT dumped on screen.
    expect(screen.queryByText('Profit reports require cost visibility.')).not.toBeInTheDocument();
  });

  it('renders revenue/COGS/gross cards and monthly rows', async () => {
    fetchMock.mockResolvedValue(
      envelope({
        date_from_bs: '2083-04-01',
        date_to_bs: '2083-04-15',
        rows: [
          {
            bs_month: '2083-04',
            sales_total: '5000.00',
            returns_total: '0.00',
            revenue: '5000.00',
            cogs: '3000.00',
            gross_profit: '2000.00',
          },
        ],
        totals: { revenue: '5000.00', cogs: '3000.00', gross_profit: '2000.00' },
      }),
    );

    renderProfit();

    // Labels appear in both the stat cards and the table header; amounts and
    // months appear in the stat cards, the desktop table, and the mobile
    // card list (the responsive pattern renders both views).
    expect((await screen.findAllByText('Revenue')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cost of goods').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Gross profit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('रू 2,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2083-04').length).toBeGreaterThan(0);
  });
});
