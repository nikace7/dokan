import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';
import { hasTokens } from '@/lib/auth/tokens';

/**
 * Route guard: unauthenticated users go to /login (and back after signing
 * in). While a stored session is being confirmed via /auth/me, render a
 * neutral splash so protected screens never flash.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  if (!hasTokens()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (isRestoring) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }
  if (!isAuthenticated) {
    // Tokens existed but the server rejected them (authedRequest clears
    // them after a failed refresh); treat as signed out.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
