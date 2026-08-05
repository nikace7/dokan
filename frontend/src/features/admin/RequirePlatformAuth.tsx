import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { usePlatformAuth } from '@/features/admin/usePlatformAuth';

export function RequirePlatformAuth({ children }: { children: ReactNode }) {
  const auth = usePlatformAuth();
  const location = useLocation();

  if (auth.isRestoring) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        Verifying platform session…
      </main>
    );
  }
  if (!auth.isAuthenticated) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }
  return children;
}
