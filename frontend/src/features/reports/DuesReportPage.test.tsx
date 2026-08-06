import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DuesReportPage } from '@/features/reports/DuesReportPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DUES = {
  receivables: [
    {
      customer_id: 'c-1',
      customer_name: 'Ram Sharma',
      buckets: { '0-30': '1000.00', '31-60': '500.00', '61-90': '0.00', '90+': '250.00' },
      total_outstanding: '1750.00',
      unallocated: '0.00',
    },
    {
      customer_id: 'c-2',
      customer_name: 'Sita Thapa',
      buckets: { '0-30': '2000.00', '31-60': '0.00', '61-90': '0.00', '90+': '0.00' },
      total_outstanding: '2000.00',
      unallocated: '100.00',
    },
  ],
  payables: [{ supplier_id: 's-1', supplier_name: 'KTM Textiles', payable: '4500.00' }],
};

describe('DuesReportPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/reports/dues')) {
        return Promise.resolve(envelope(DUES));
      }
      return Promise.reject(new Error(`Unexpected request: GET ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('renders the aging buckets per customer with bucket and grand totals', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <DuesReportPage />
      </QueryClientProvider>,
    );

    // Customer names render in both the mobile card list and the desktop
    // table; scope structural checks to the desktop tables.
    expect((await screen.findAllByText('Ram Sharma')).length).toBeGreaterThan(0);
    const tables = container.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    const receivables = within(tables[0] as HTMLTableElement);
    const payables = within(tables[1] as HTMLTableElement);

    // Customer rows with their bucket values.
    expect(receivables.getByText('Ram Sharma')).toBeInTheDocument();
    expect(receivables.getByText('Sita Thapa')).toBeInTheDocument();
    const ramRow = receivables.getByText('Ram Sharma').closest('tr');
    expect(ramRow).toHaveTextContent('1,000.00');
    expect(ramRow).toHaveTextContent('500.00');
    expect(ramRow).toHaveTextContent('250.00');
    expect(ramRow).toHaveTextContent('रू 1,750.00');

    // Bucket headers.
    expect(receivables.getByText('0-30 days')).toBeInTheDocument();
    expect(receivables.getByText('90+ days')).toBeInTheDocument();

    // Totals footer: 0-30 bucket 1000+2000=3,000.00; grand 1750+2000=रू 3,750.00.
    // The tfoot totals row of the receivables table.
    const totalsRow = tables[0]?.querySelector('tfoot tr');
    expect(totalsRow).not.toBeNull();
    expect(totalsRow).toHaveTextContent('3,000.00');
    expect(totalsRow).toHaveTextContent('रू 3,750.00');

    // Payables section (the payable also appears in the table totals row).
    expect(payables.getByText('KTM Textiles')).toBeInTheDocument();
    expect(payables.getAllByText('रू 4,500.00').length).toBeGreaterThan(0);
  });
});
