import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TenantsPage } from '@/features/admin/TenantsPage';
import { clearPlatformTokens, setPlatformTokens } from '@/features/admin/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data, meta, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TenantsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setPlatformTokens({ access: 'platform-access', refresh: 'platform-refresh' });
    fetchMock.mockImplementation((input) => {
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
      if (url.includes('/v1/admin/plans')) {
        return Promise.resolve(envelope([], { count: 0, page: 1, total_pages: 1, page_size: 50 }));
      }
      if (url.includes('/v1/admin/tenants')) {
        return Promise.resolve(
          envelope(
            [
              {
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

  it('shows tenant status to support without exposing lifecycle writes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TenantsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const shop = await screen.findByText('Demo Shop');
    expect(shop).toBeInTheDocument();
    expect(shop.closest('tr')).toHaveTextContent('demo');
    expect(shop.closest('tr')).toHaveTextContent('ACTIVE');
    expect(screen.queryByRole('button', { name: 'New tenant' })).not.toBeInTheDocument();
  });
});
