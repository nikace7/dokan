import { lazy, Suspense, useEffect } from 'react';

import { onPlatformSignedOut } from '@/features/admin/authed';
import { isPlatformHost } from '@/features/admin/supportHandoff';
import { onSignedOut } from '@/lib/api/authed';
import { initOfflineSync } from '@/lib/offline/sync';
import { initVersionCheck } from '@/lib/versionCheck';

import { AppProviders } from './providers';

const AdminRouter = lazy(() =>
  import('@/features/admin/router').then(({ AdminRouter: Component }) => ({ default: Component })),
);
const TenantRouter = lazy(() =>
  import('./router').then(({ AppRouter: Component }) => ({ default: Component })),
);

function AppLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Loading application…
    </main>
  );
}

export default function App() {
  const platformHost = isPlatformHost(window.location.hostname);

  useEffect(() => {
    // The offline POS is a tenant-screen concern only — the admin host
    // never bills, so no queue drain runs there.
    if (!platformHost) {
      initOfflineSync();
    }
  }, [platformHost]);

  useEffect(
    // A 401 that even a token refresh can't fix means the session is dead
    // (revoked, tenant-claim mismatch, expired refresh). Tokens are already
    // cleared by authedRequest; a full navigation also drops in-memory
    // state (router, query cache) belonging to the old session.
    () =>
      platformHost
        ? onPlatformSignedOut(() => window.location.assign('/admin/login'))
        : onSignedOut(() => window.location.assign('/login')),
    [platformHost],
  );

  // Long-lived tabs/PWAs never reload themselves — poll the build stamp and
  // toast a reload action once a newer deploy exists (both portals).
  useEffect(() => initVersionCheck(), []);

  return (
    <AppProviders>
      <Suspense fallback={<AppLoading />}>
        {platformHost ? <AdminRouter /> : <TenantRouter />}
      </Suspense>
    </AppProviders>
  );
}
