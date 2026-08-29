import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReportsHomePage } from '@/features/reports/ReportsHomePage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function me(features: Record<string, boolean>): Response {
  return new Response(
    JSON.stringify({
      data: {
        id: 'user-1',
        phone: '9800000000',
        full_name: 'Demo Owner',
        email: null,
        must_change_password: false,
        permissions: ['report.sales', 'report.profit', 'report.vat'],
        plan: { code: 'basic', name: 'Basic', features },
      },
      error: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function renderReports() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportsHomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReportsHomePage plan visibility', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('hides plan-gated report links when features are disabled', async () => {
    fetchMock.mockResolvedValueOnce(me({ profit_reports: false, vat_module: false }));

    renderReports();

    expect(await screen.findByRole('link', { name: /^sales/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /profit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /vat register/i })).not.toBeInTheDocument();
  });

  it('shows plan-gated report links when features are enabled', async () => {
    fetchMock.mockResolvedValueOnce(me({ profit_reports: true, vat_module: true }));

    renderReports();

    expect(await screen.findByRole('link', { name: /profit/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /vat register/i })).toBeInTheDocument();
  });

  it('shows only the reports the role may view', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'user-2',
            phone: '9811111111',
            full_name: 'Store Auditor',
            email: null,
            must_change_password: false,
            permissions: ['report.stock'],
            plan: {
              code: 'pro',
              name: 'Pro',
              features: { profit_reports: true, vat_module: true },
            },
          },
          error: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderReports();

    expect(await screen.findByRole('link', { name: /^stock/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^sales/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /profit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dues/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /vat register/i })).not.toBeInTheDocument();
  });
});
