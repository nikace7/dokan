import { fireEvent, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRouter } from '@/app/router';

vi.mock('@/features/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/features/auth/RequireAccess', () => ({
  RequireAccess: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: () => (
    <>
      <nav>shop menu</nav>
      <Outlet />
    </>
  ),
}));
vi.mock('@/features/dashboard/DashboardPage', () => ({
  DashboardPage: () => {
    throw new Error('screen bug');
  },
}));

describe('AppRouter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows a friendly page with the menu when a screen crashes', async () => {
    // React reports the caught error; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });

    render(
      <Suspense fallback={null}>
        <AppRouter />
      </Suspense>,
    );

    expect(await screen.findByText('Something went wrong on this page')).toBeInTheDocument();
    expect(screen.queryByText(/screen bug/)).not.toBeInTheDocument();
    expect(screen.getByText('shop menu')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
