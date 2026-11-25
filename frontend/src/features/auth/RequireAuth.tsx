import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';
import { hasTokens } from '@/lib/auth/tokens';
import { useAuthSession } from '@/stores/authSession';

/**
 * Route guard: unauthenticated users go to /login (and back after signing
 * in). While a stored session is being confirmed via /auth/me, render a
 * neutral splash so protected screens never flash.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();
  // After "Sign out" the next person starts at the dashboard, not on the page
  // this one was reading. An expired session or an opened link goes back.
  const signedOut = useAuthSession((state) => state.rev > 0);
  const toLogin = <Navigate to="/login" state={signedOut ? null : { from: location }} replace />;

  if (!hasTokens()) {
    return toLogin;
  }
  if (isRestoring) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      </main>
    );
  }
  if (!isAuthenticated) {
    // Tokens existed but the server rejected them (authedRequest clears
    // them after a failed refresh); treat as signed out.
    return toLogin;
  }
  return <>{children}</>;
}
