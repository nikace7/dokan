import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequireAuth } from '@/features/auth/RequireAuth';
import { useAuth } from '@/features/auth/useAuth';
import { clearTokens, setTokens } from '@/lib/auth/tokens';
import { useCartStore } from '@/stores/cartStore';

const fetchMock = vi.fn<typeof fetch>();

const ME = {
  id: 'user-1',
  phone: '9800000000',
  full_name: 'Ram Sharma',
  email: null,
  must_change_password: false,
  is_owner: true,
  permissions: [],
  plan: { code: 'pro', name: 'Pro', features: {} },
  shop_name: 'Test Shop',
  shop_name_np: null,
  currency: 'NPR',
};

function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={signOut}>
      sign out
    </button>
  );
}

function LoginStub() {
  const state = useLocation().state as { from?: { pathname: string } } | null;
  return (
    <>
      <p>login page</p>
      <p>returns to {state?.from?.pathname ?? 'nowhere'}</p>
    </>
  );
}

function renderGuardedApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<LoginStub />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <p>protected page</p>
                <SignOutButton />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('sign out', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
    fetchMock.mockImplementation((input) => {
      if (String(input).includes('/v1/auth/me')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: ME, error: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (String(input).includes('/v1/auth/logout')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { accepted: true }, error: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('remembers the page a signed-out visitor asked for', () => {
    clearTokens();
    renderGuardedApp();
    expect(screen.getByText('returns to /')).toBeInTheDocument();
  });

  it('redirects to /login immediately — no manual refresh needed', async () => {
    renderGuardedApp();

    expect(await screen.findByText('protected page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sign out' }));
    expect(await screen.findByText('login page')).toBeInTheDocument();
    // The next person starts at the dashboard, not where this one stopped.
    expect(screen.getByText('returns to nowhere')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/auth/logout'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('leaves no cart behind for the next person at the counter', async () => {
    useCartStore.getState().addLine({
      variantId: 'var-1',
      sku: 'TS-BLK-M',
      label: 'T-Shirt — M / Black',
      quantity: 1,
      unitPricePaisa: 150000,
      discountPaisa: 0,
    });
    useCartStore.getState().setCustomer({ id: 'c-1', name: 'Sita', phone: '9811111111' });
    renderGuardedApp();

    fireEvent.click(await screen.findByRole('button', { name: 'sign out' }));

    expect(useCartStore.getState().lines).toEqual([]);
    expect(useCartStore.getState().customer).toBeNull();
  });
});
