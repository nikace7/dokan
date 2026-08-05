import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CountsPage } from '@/features/inventory/CountsPage';
import type { StockCount } from '@/features/inventory/api';
import { TransfersPage } from '@/features/inventory/TransfersPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown): Response {
  return new Response(
    JSON.stringify({
      data,
      meta: Array.isArray(data)
        ? { count: data.length, page: 1, page_size: 50, total_pages: 1 }
        : null,
      error: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const branches = [
  { id: 'branch-main', code: 'MAIN', name: 'Main', is_default: true, is_active: true },
  { id: 'branch-outlet', code: 'OUTLET', name: 'Outlet', is_default: false, is_active: true },
];

const transfer = {
  id: 'transfer-1',
  from_branch: 'branch-main',
  from_branch_code: 'MAIN',
  to_branch: 'branch-outlet',
  to_branch_code: 'OUTLET',
  status: 'DRAFT',
  sent_at: null,
  received_at: null,
  note: 'Restock outlet',
  created_by: 'user-1',
  created_by_name: 'Owner',
  created_at: '2026-08-05T00:00:00Z',
  items: [
    {
      id: 'transfer-item-1',
      variant: 'variant-1',
      variant_sku: 'SHIRT-M',
      item_name: 'Oxford Shirt',
      qty_sent: '3.000',
      qty_received: null,
    },
  ],
};

const count: StockCount = {
  id: 'count-1',
  branch: 'branch-main',
  branch_code: 'MAIN',
  status: 'OPEN',
  started_at: '2026-08-05T00:00:00Z',
  finalized_at: null,
  created_by: 'user-1',
  created_by_name: 'Owner',
  items: [
    {
      id: 'count-item-1',
      variant: 'variant-1',
      variant_sku: 'SHIRT-M',
      item_name: 'Oxford Shirt',
      system_qty: '10.000',
      counted_qty: null,
      variance: null,
      note: null,
    },
  ],
};

function me(permissions: string[], multiBranch = true) {
  return {
    id: 'user-1',
    phone: '9800000000',
    full_name: 'Stock User',
    email: null,
    must_change_password: false,
    is_owner: false,
    permissions,
    plan: { code: 'pro', name: 'Pro', features: { multi_branch: multiBranch } },
  };
}

function renderPage(page: 'transfers' | 'counts') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{page === 'transfers' ? <TransfersPage /> : <CountsPage />}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockApi(
  permissions: string[],
  multiBranch = true,
  transferStatus: 'DRAFT' | 'SENT' = 'DRAFT',
) {
  let currentCount = count;
  const currentTransfer = { ...transfer, status: transferStatus };
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.includes('/v1/auth/me')) return envelope(me(permissions, multiBranch));
    if (url.includes('/v1/branches')) return envelope(branches);
    if (url.includes('/v1/pricing/rate-types')) {
      return envelope([{ id: 'retail-1', name: 'Retail', is_default: true, is_active: true }]);
    }
    if (url.includes('/v1/catalog/items')) {
      return envelope([{ id: 'item-1', code: 'SHIRT', name: 'Oxford Shirt', is_active: true }]);
    }
    if (url.includes('/v1/catalog/variants')) {
      return envelope([
        {
          id: 'variant-1',
          item: 'item-1',
          size: 'M',
          color: 'Blue',
          sku: 'SHIRT-M',
          mrp: '1200.00',
          is_active: true,
        },
      ]);
    }
    if (url.includes('/v1/inventory/transfers/in-transit')) return envelope([]);
    if (url.endsWith('/v1/inventory/transfers/transfer-1/send')) {
      return envelope({ ...transfer, status: 'SENT' });
    }
    if (url.endsWith('/v1/inventory/transfers/transfer-1/receive')) {
      return envelope({
        ...currentTransfer,
        items: [{ ...transfer.items[0], qty_received: '2.000' }],
      });
    }
    if (url.endsWith('/v1/inventory/transfers/transfer-1/complete')) {
      return envelope({ ...currentTransfer, status: 'RECEIVED' });
    }
    if (url.includes('/v1/inventory/transfers') && init?.method === 'POST') {
      return envelope({ ...transfer, id: 'transfer-new', ...body });
    }
    if (url.includes('/v1/inventory/transfers')) return envelope([currentTransfer]);
    if (url.endsWith('/v1/inventory/counts/count-1/record')) {
      currentCount = {
        ...count,
        items: [{ ...count.items[0], counted_qty: '9.000', variance: '-1.000' }],
      };
      return envelope(currentCount);
    }
    if (url.endsWith('/v1/inventory/counts/count-1/finalize')) {
      currentCount = { ...currentCount, status: 'FINALIZED' };
      return envelope(currentCount);
    }
    if (url.includes('/v1/inventory/counts') && init?.method === 'POST') {
      return envelope(count);
    }
    if (url.includes('/v1/inventory/counts')) return envelope([currentCount]);
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
}

async function pickVariant() {
  fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'shirt' } });
  fireEvent.click(await screen.findByRole('button', { name: /Oxford Shirt/ }));
  fireEvent.click(await screen.findByRole('button', { name: /M \/ Blue/ }));
}

describe('TransfersPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    localStorage.clear();
  });

  it('shows transfer history without transition controls to a viewer', async () => {
    mockApi(['stock.view']);
    renderPage('transfers');

    expect(await screen.findByRole('heading', { name: 'MAIN → OUTLET' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create transfer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send transfer' })).not.toBeInTheDocument();
  });

  it('creates a transfer and can send a draft', async () => {
    mockApi(['stock.view', 'stock.adjust']);
    renderPage('transfers');

    fireEvent.change(await screen.findByLabelText('Destination branch'), {
      target: { value: 'branch-outlet' },
    });
    await pickVariant();
    fireEvent.change(screen.getByLabelText('Transfer quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add transfer line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create transfer' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/inventory/transfers'),
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('variant-1') }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send transfer' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/transfers/transfer-1/send'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('explains when transfers are outside the tenant plan', async () => {
    mockApi(['stock.view', 'stock.adjust'], false);
    renderPage('transfers');
    expect(await screen.findByText(/does not include multi-branch transfers/i)).toBeInTheDocument();
  });

  it('receives quantities and completes a sent transfer with the shortage warning', async () => {
    mockApi(['stock.view', 'stock.adjust'], true, 'SENT');
    renderPage('transfers');

    fireEvent.change(await screen.findByLabelText('Receive SHIRT-M'), {
      target: { value: '2' },
    });
    expect(screen.getByText(/remaining quantity off as a transfer shortage/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Receive entered' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/transfers/transfer-1/receive'),
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"qty":"2"') }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Complete transfer' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/transfers/transfer-1/complete'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});

describe('CountsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    localStorage.clear();
  });

  it('starts, records, and finalizes a physical count', async () => {
    mockApi(['stock.view', 'stock.adjust']);
    renderPage('counts');

    fireEvent.click(await screen.findByRole('button', { name: 'Start physical count' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/inventory/counts'),
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('branch-main') }),
      ),
    );

    fireEvent.change(screen.getByLabelText('Counted quantity SHIRT-M'), {
      target: { value: '9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save counted quantities' }));
    expect(await screen.findByText('-1.000')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Finalize count' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/counts/count-1/finalize'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
