import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@/components/layout/AppShell';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

let features: Record<string, unknown> = {};

function me(features: Record<string, unknown>) {
  return {
    id: 'user-1',
    phone: '9800000000',
    full_name: 'Ram Sharma',
    email: null,
    must_change_password: false,
    is_owner: true,
    permissions: [],
    plan: { code: 'pro', name: 'Pro', features },
  };
}

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={null} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell billing nav', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: me(features), error: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
    features = {};
  });

  it('points Billing at the classic POS with advanced_pos', async () => {
    features = { simple_sale: true, advanced_pos: true };
    renderShell();

    await screen.findAllByRole('link', { name: /billing/i });
    // The link re-mounts when /auth/me lands (its key is the target path),
    // so re-query instead of holding the first-render nodes.
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /billing/i });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link).toHaveAttribute('href', '/billing');
      }
    });
  });

  it('points Billing at the simple sale screen without advanced_pos', async () => {
    features = { simple_sale: true, advanced_pos: false };
    renderShell();

    await screen.findAllByRole('link', { name: /billing/i });
    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /billing/i });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link).toHaveAttribute('href', '/billing/simple');
      }
    });
  });
});
