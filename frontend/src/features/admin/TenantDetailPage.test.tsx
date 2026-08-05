import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('TenantDetailPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setPlatformTokens({ access: 'platform-access', refresh: 'platform-refresh' });
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/v1/admin/auth/me')) {
        return Promise.resolve(
          envelope({
            id: 'support-1',
            email: 'support@dokan.test',
            full_name: 'Ram Support',
            role: 'SUPPORT',
          }),
        );
      }
      if (url.endsWith('/v1/admin/tenants/tenant-1')) {
        return Promise.resolve(
          envelope({
            id: 'tenant-1',
            slug: 'demo',
            name: 'Demo Shop',
            plan: 'plan-1',
            plan_code: 'basic',
            plan_name: 'Basic',
            status: 'ACTIVE',
            trial_ends_at: null,
            calendar_pref: 'BS',
            locale: 'np',
            created_at: '2026-08-01T00:00:00Z',
          }),
        );
      }
      if (url.endsWith('/users')) {
        return Promise.resolve(
          envelope([{ id: 'owner-1', phone: '9800000000', full_name: 'Demo Owner' }]),
        );
      }
      if (url.endsWith('/impersonate') && init?.method === 'POST') {
        return Promise.resolve(
          envelope(
            {
              session: {
                id: 'session-1',
                platform_user: 'support-1',
                platform_user_name: 'Ram Support',
                tenant: 'tenant-1',
                target_user_id: 'owner-1',
                reason: 'Investigating a reported billing discrepancy.',
                scope: 'READ_ONLY',
                started_at: '2026-08-05T00:00:00Z',
                expires_at: '2026-08-05T00:15:00Z',
                ended_at: null,
              },
              access: 'tenant.token/value',
              token_type: 'Bearer',
            },
            undefined,
            201,
          ),
        );
      }
      if (url.endsWith('/subscriptions') || url.endsWith('/usage') || url.endsWith('/overrides')) {
        return Promise.resolve(envelope([], { count: 0, page: 1, total_pages: 1, page_size: 50 }));
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearPlatformTokens();
  });

  it('starts read-only support access and exposes a fragment-only tenant handoff', async () => {
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

    expect(await screen.findByText('Demo Shop')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Target user'), {
      target: { value: 'owner-1' },
    });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Investigating a reported billing discrepancy.' },
    });
    expect(screen.queryByRole('option', { name: 'Read/write' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start support access' }));

    const link = await screen.findByRole('link', { name: 'Open audited tenant session' });
    expect(link).toHaveAttribute(
      'href',
      'http://demo.localhost:3000/support-login#access=tenant.token%2Fvalue',
    );
    expect(link.getAttribute('href')).not.toContain('?');
  });
});
