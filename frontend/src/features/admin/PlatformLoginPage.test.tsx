import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlatformLoginPage } from '@/features/admin/PlatformLoginPage';
import {
  clearPlatformTokens,
  getPlatformAccessToken,
  getPlatformRefreshToken,
} from '@/features/admin/tokens';
import { clearTokens, getAccessToken } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/login']}>
        <Routes>
          <Route path="/admin/login" element={<PlatformLoginPage />} />
          <Route path="/admin" element={<p>platform dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PlatformLoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearPlatformTokens();
    clearTokens();
  });

  it('uses mandatory TOTP and keeps platform tokens out of the tenant realm', async () => {
    fetchMock
      .mockResolvedValueOnce(
        envelope({ access: 'platform-access', refresh: 'platform-refresh', token_type: 'Bearer' }),
      )
      .mockResolvedValueOnce(
        envelope({
          id: 'platform-1',
          email: 'admin@dokan.test',
          full_name: 'Platform Admin',
          role: 'SUPER_ADMIN',
        }),
      );

    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'admin@dokan.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }));

    expect(await screen.findByText('platform dashboard')).toBeInTheDocument();
    expect(getPlatformAccessToken()).toBe('platform-access');
    expect(getPlatformRefreshToken()).toBe('platform-refresh');
    expect(getAccessToken()).toBeNull();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      email: 'admin@dokan.test',
      password: 'correct horse battery staple',
      otp: '123456',
    });
  });
});
