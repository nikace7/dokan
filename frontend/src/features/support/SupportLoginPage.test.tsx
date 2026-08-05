import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { SupportLoginPage } from '@/features/support/SupportLoginPage';
import { clearTokens, getAccessToken, getRefreshToken } from '@/lib/auth/tokens';

function token(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `x.${encoded}.x`;
}

function renderHandoff(access: string) {
  window.history.replaceState(null, '', `/support-login#access=${encodeURIComponent(access)}`);
  render(
    <MemoryRouter initialEntries={['/support-login']}>
      <Routes>
        <Route path="/support-login" element={<SupportLoginPage />} />
        <Route path="/" element={<p>tenant home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SupportLoginPage', () => {
  afterEach(() => {
    clearTokens();
    window.history.replaceState(null, '', '/');
  });

  it('accepts only a live impersonation access token and stores no refresh token', async () => {
    const access = token({
      act: 'platform-1',
      jti: 'session-1',
      scope: 'read_only',
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    renderHandoff(access);

    expect(await screen.findByText('tenant home')).toBeInTheDocument();
    expect(getAccessToken()).toBe(access);
    expect(getRefreshToken()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('rejects an expired or ordinary tenant token', () => {
    renderHandoff(token({ exp: 1 }));

    expect(screen.getByRole('alert')).toHaveTextContent('Support link is invalid or expired.');
    expect(getAccessToken()).toBeNull();
  });
});
