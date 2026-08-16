import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TenantDetailPage } from '@/features/admin/TenantDetailPage';
import { clearPlatformTokens, setPlatformTokens } from '@/features/admin/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, meta?: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ data, meta, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PAGE_META = { count: 0, page: 1, total_pages: 1, page_size: 50 };

const TENANT = {
  id: 'tenant-1',
  slug: 'demo',
  name: 'Demo Shop',
  legal_name: 'Demo Traders Pvt. Ltd.',
  pan_vat_no: '123456789',
  vat_registered: true,
  plan: 'plan-1',
  plan_code: 'basic',
  plan_name: 'Basic',
  status: 'ACTIVE',
  trial_ends_at: '2026-08-15T00:00:00Z',
  calendar_pref: 'BS',
  locale: 'np',
  onboarded_at: '2026-08-02T00:00:00Z',
  created_at: '2026-08-01T00:00:00Z',
};

const SNAPSHOT = {
  id: 'snap-1',
  date: '2026-08-10',
  users: 3,
  items: 120,
  invoices_mtd: 45,
  storage_mb: 40,
  sms_used: 12,
};

interface MockOptions {
  role?: 'SUPPORT' | 'SUPER_ADMIN';
  tenant?: typeof TENANT;
  usage?: Array<typeof SNAPSHOT>;
}

function installApiMock({ role = 'SUPER_ADMIN', tenant = TENANT, usage = [] }: MockOptions = {}) {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/v1/admin/auth/me')) {
      return Promise.resolve(
        envelope({ id: 'user-1', email: 'admin@dokan.test', full_name: 'Ram Admin', role }),
      );
    }
    if (url.endsWith('/v1/admin/tenants/tenant-1') && method === 'PATCH') {
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(envelope({ ...tenant, ...patch }));
    }
    if (url.endsWith('/v1/admin/tenants/tenant-1')) {
      return Promise.resolve(envelope(tenant));
    }
    if (url.endsWith('/usage')) {
      return Promise.resolve(envelope(usage, { ...PAGE_META, count: usage.length }));
    }
    if (url.endsWith('/subscriptions') || url.endsWith('/overrides')) {
      return Promise.resolve(envelope([], PAGE_META));
    }
    if (url.endsWith('/users')) {
      return Promise.resolve(envelope([]));
    }
    if (url.includes('/v1/admin/plans')) {
      return Promise.resolve(envelope([], PAGE_META));
    }
    return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/tenants/tenant-1']}>
        <Routes>
          <Route path="/admin/tenants/:id" element={<TenantDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function patchCalls() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
}

describe('TenantDetailPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setPlatformTokens({ access: 'platform-access', refresh: 'platform-refresh' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearPlatformTokens();
  });

  it('renders profile facts and the latest usage rows', async () => {
    installApiMock({ role: 'SUPPORT', usage: [SNAPSHOT] });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Demo Shop' })).toBeInTheDocument();
    expect(screen.getByText('demo')).toBeInTheDocument();
    expect(screen.getByText('Demo Traders Pvt. Ltd.')).toBeInTheDocument();
    expect(screen.getByText('123456789')).toBeInTheDocument();
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();

    // Usage table shows the snapshot values.
    const dateCell = await screen.findByText('2026-08-10');
    expect(dateCell.closest('tr')).toHaveTextContent('120');
    expect(dateCell.closest('tr')).toHaveTextContent('45');

    // Support gets no lifecycle writes.
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
  });

  it('shows an empty state when no usage snapshots exist', async () => {
    installApiMock({ role: 'SUPPORT', usage: [] });
    renderPage();
    expect(await screen.findByText('No usage snapshots yet')).toBeInTheDocument();
  });

  it('suspends an active tenant after confirmation', async () => {
    installApiMock({ role: 'SUPER_ADMIN' });
    renderPage();
    await screen.findByRole('heading', { name: 'Demo Shop' });

    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Suspend tenant?');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(JSON.parse(String(patchCalls()[0][1]?.body))).toEqual({ status: 'SUSPENDED' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reactivates a suspended tenant after confirmation', async () => {
    installApiMock({ role: 'SUPER_ADMIN', tenant: { ...TENANT, status: 'SUSPENDED' } });
    renderPage();
    await screen.findByRole('heading', { name: 'Demo Shop' });

    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Reactivate tenant?');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(JSON.parse(String(patchCalls()[0][1]?.body))).toEqual({ status: 'ACTIVE' });
  });
});
