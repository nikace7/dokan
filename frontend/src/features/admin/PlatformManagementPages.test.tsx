import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlansPage } from '@/features/admin/PlansPage';
import { PlatformAuditPage } from '@/features/admin/PlatformAuditPage';
import { clearPlatformTokens, setPlatformTokens } from '@/features/admin/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data, meta, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage(page: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('platform management pages', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setPlatformTokens({ access: 'platform-access', refresh: 'platform-refresh' });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/admin/auth/me')) {
        return Promise.resolve(
          envelope({
            id: 'admin-1',
            email: 'admin@dokan.test',
            full_name: 'Platform Admin',
            role: 'SUPER_ADMIN',
          }),
        );
      }
      if (url.includes('/v1/admin/plans')) {
        return Promise.resolve(
          envelope(
            [
              {
                id: 'plan-1',
                code: 'basic',
                name: 'Basic',
                price_npr: '1500.00',
                billing_cycle: 'monthly',
                limits: { max_users: 5 },
                features: { sms: true },
                is_active: true,
                sort_order: 10,
              },
            ],
            { count: 1, page: 1, total_pages: 1, page_size: 50 },
          ),
        );
      }
      if (url.includes('/v1/admin/audit')) {
        return Promise.resolve(
          envelope(
            [
              {
                id: 'audit-1',
                platform_user: 'admin-1',
                platform_user_name: 'Platform Admin',
                action: 'tenant.suspend',
                tenant: 'tenant-1',
                payload: { before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED' } },
                ip: '203.0.113.8',
                created_at: '2026-08-05T00:00:00Z',
              },
            ],
            { count: 1, page: 1, total_pages: 1, page_size: 50 },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearPlatformTokens();
  });

  it('shows plan configuration to a super admin', async () => {
    renderPage(<PlansPage />);
    expect(await screen.findByText('Basic')).toBeInTheDocument();
    expect(screen.getByText('max_users')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New plan' })).toBeInTheDocument();
  });

  it('creates a plan from the friendly editors', async () => {
    renderPage(<PlansPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'New plan' }));

    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'PRO' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pro' } });
    fireEvent.change(screen.getByLabelText('Price (NPR)'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('Staff accounts'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('switch', { name: 'SMS receipts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input).includes('/v1/admin/plans') && init?.method === 'POST',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String(call?.[1]?.body)) as {
        limits: Record<string, unknown>;
        features: Record<string, unknown>;
      };
      expect(body).toMatchObject({
        code: 'pro',
        name: 'Pro',
        price_npr: '3000',
        billing_cycle: 'monthly',
        is_active: true,
      });
      expect(body.limits).toEqual({ max_users: 10 });
      expect(body.features).toMatchObject({
        sms: true,
        simple_sale: false,
        advanced_pos: false,
        profit_reports: false,
        vat_module: false,
        multi_branch: false,
        custom_rate_types: false,
      });
      expect(body.features).not.toHaveProperty('max_rate_types');
    });
  });

  it('shows immutable platform audit context', async () => {
    renderPage(<PlatformAuditPage />);
    expect(await screen.findByText('tenant.suspend')).toBeInTheDocument();
    expect(screen.getByText('Platform Admin')).toBeInTheDocument();
    expect(screen.getByText(/SUSPENDED/)).toBeInTheDocument();
  });
});
