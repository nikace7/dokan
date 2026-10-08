import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequireAccess } from '@/features/auth/RequireAccess';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function signedInAs(permissions: string[]) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ data: { id: 'user-1', permissions, plan: null }, error: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RequireAccess path={path}>
          <p>Page content</p>
        </RequireAccess>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RequireAccess', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'a', refresh: 'r' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('explains instead of opening a page the role cannot use', async () => {
    signedInAs(['catalog.view', 'stock.view']);
    renderAt('/payments');

    expect(await screen.findByText("This page isn't part of your role")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to dashboard' })).toBeInTheDocument();
    expect(screen.queryByText('Page content')).not.toBeInTheDocument();
  });

  it('opens the page when any one listed permission is held', async () => {
    signedInAs(['payment.receive']);
    renderAt('/payments');

    expect(await screen.findByText('Page content')).toBeInTheDocument();
  });

  it('opens unlisted pages, like your own security settings, for everyone', () => {
    signedInAs([]);
    renderAt('/settings/security');

    expect(screen.getByText('Page content')).toBeInTheDocument();
  });
});
