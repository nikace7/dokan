import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginPage } from '@/features/auth/LoginPage';
import { getAccessToken, getRefreshToken, clearTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>home screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('logs in with phone + password, stores the token pair, and lands home', async () => {
    fetchMock
      // POST /v1/auth/token
      .mockResolvedValueOnce(envelope({ access: 'access-1', refresh: 'refresh-1' }))
      // GET /v1/auth/me (invalidateQueries after login)
      .mockResolvedValueOnce(
        envelope({
          id: 'u-1',
          phone: '9800000000',
          full_name: 'Demo Owner',
          email: null,
          must_change_password: false,
          permissions: ['sale.create'],
        }),
      );

    renderLogin();

    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '9800000000' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'demo1234' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('home screen')).toBeInTheDocument();
    expect(getAccessToken()).toBe('access-1');
    expect(getRefreshToken()).toBe('refresh-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v1/auth/token');
    expect(JSON.parse(String(init?.body))).toEqual({
      phone: '9800000000',
      password: 'demo1234',
    });
  });

  it('shows the server error message on bad credentials', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: null,
          error: { code: 'AUTH_FAILED', message: 'Phone number or password is incorrect.' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderLogin();

    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '9800000000' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Phone number or password is incorrect.')).toBeInTheDocument();
    expect(getAccessToken()).toBeNull();
  });
});
