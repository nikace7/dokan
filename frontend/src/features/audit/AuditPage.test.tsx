import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditPage } from '@/features/audit/AuditPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

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

function renderAudit() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

const row = {
  id: 'audit-1',
  actor: 'user-1',
  actor_name: 'Owner',
  action: 'price.set',
  target_type: 'item_price',
  target_id: 'price-1',
  before: { amount: '1200.00' },
  after: { amount: '1500.00' },
  impersonated_by: null,
  ip: '127.0.0.1',
  created_at: '2026-08-03T10:00:00Z',
};

describe('AuditPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
    fetchMock.mockResolvedValue(page([row]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('renders an audit row and expands before/after details', async () => {
    renderAudit();

    expect(await screen.findByText('price.set')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /price\.set.*item_price/i }));

    expect(screen.getByText(/1500\.00/)).toBeInTheDocument();
    expect(screen.getByText(/1200\.00/)).toBeInTheDocument();
  });

  it('sends the action filter to the server', async () => {
    renderAudit();
    await screen.findByText('price.set');
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'stock.adjust' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('action=stock.adjust'),
        expect.anything(),
      );
    });
  });
});
