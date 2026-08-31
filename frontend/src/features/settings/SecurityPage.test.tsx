import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecurityPage } from '@/features/settings/SecurityPage';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SecurityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SecurityPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access', refresh: 'refresh' });
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/v1/auth/login-otp') && method === 'GET') {
        return envelope({ enabled: false });
      }
      if (url.endsWith('/v1/auth/sessions') && method === 'GET') {
        return envelope([
          {
            id: '11111111-1111-4111-8111-111111111111',
            device_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            device_name: 'Front counter',
            ip: '127.0.0.1',
            last_seen_at: '2026-08-31T10:00:00Z',
            created_at: '2026-08-30T10:00:00Z',
            expires_at: '2026-09-30T10:00:00Z',
            revoked_at: null,
            current: true,
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            device_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            device_name: 'Owner phone',
            ip: null,
            last_seen_at: '2026-08-30T10:00:00Z',
            created_at: '2026-08-29T10:00:00Z',
            expires_at: '2026-09-29T10:00:00Z',
            revoked_at: null,
            current: false,
          },
        ]);
      }
      if (url.endsWith('/v1/auth/login-otp/request') && method === 'POST') {
        return envelope({ accepted: true }, 202);
      }
      if (url.endsWith('/v1/auth/login-otp/confirm') && method === 'POST') {
        return envelope({ enabled: true });
      }
      if (url.includes('/v1/auth/sessions/') && method === 'POST') {
        return envelope({ id: '22222222-2222-4222-8222-222222222222', revoked_at: 'now' });
      }
      if (url.endsWith('/v1/auth/password/change') && method === 'POST') {
        return envelope({ accepted: true });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('enables login OTP and revokes another registered device', async () => {
    renderPage();
    expect(await screen.findByText('Front counter')).toBeInTheDocument();
    expect(screen.getByText('Owner phone')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enable login code' }));
    fireEvent.change(await screen.findByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm code' }));
    expect(await screen.findByText('Login code is enabled.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Owner phone' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('22222222-2222-4222-8222-222222222222/revoke'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('changes the password and confirms other devices are revoked', async () => {
    renderPage();
    await screen.findByText('Front counter');
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'New-safe-pass-456' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'New-safe-pass-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
  });
});
