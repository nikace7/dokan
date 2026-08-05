import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequirePlatformAuth } from '@/features/admin/RequirePlatformAuth';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';

vi.mock('@/features/admin/usePlatformAuth');

const mockedUsePlatformAuth = vi.mocked(usePlatformAuth);

function renderGuard() {
  render(
    <MemoryRouter initialEntries={['/admin/tenants']}>
      <Routes>
        <Route path="/admin/login" element={<p>platform login</p>} />
        <Route
          path="/admin/tenants"
          element={
            <RequirePlatformAuth>
              <p>tenant control plane</p>
            </RequirePlatformAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequirePlatformAuth', () => {
  beforeEach(() => {
    mockedUsePlatformAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isRestoring: false,
      isLoggingIn: false,
      loginError: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
  });

  it('redirects an unauthenticated platform request to the platform login', () => {
    renderGuard();

    expect(screen.getByText('platform login')).toBeInTheDocument();
  });

  it('renders the protected control plane after platform authentication', () => {
    mockedUsePlatformAuth.mockReturnValue({
      user: {
        id: 'platform-1',
        email: 'admin@example.com',
        full_name: 'Platform Admin',
        role: 'SUPER_ADMIN',
      },
      isAuthenticated: true,
      isRestoring: false,
      isLoggingIn: false,
      loginError: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    renderGuard();

    expect(screen.getByText('tenant control plane')).toBeInTheDocument();
  });
});
