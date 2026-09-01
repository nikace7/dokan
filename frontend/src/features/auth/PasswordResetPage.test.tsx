import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PasswordResetPage } from '@/features/auth/PasswordResetPage';

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
      <MemoryRouter initialEntries={['/forgot-password']}>
        <Routes>
          <Route path="/forgot-password" element={<PasswordResetPage />} />
          <Route path="/login" element={<p>login screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PasswordResetPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('requests an enumeration-safe SMS code and resets the password', async () => {
    fetchMock
      .mockResolvedValueOnce(envelope({ accepted: true }, 202))
      .mockResolvedValueOnce(envelope({ accepted: true }));
    renderPage();

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9800000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    expect(await screen.findByText(/if an active account exists/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'New-safe-pass-456' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'New-safe-pass-456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText('Your password has been reset.')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      phone: '9800000000',
      code: '123456',
      new_password: 'New-safe-pass-456',
    });
  });
});
