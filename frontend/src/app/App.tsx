import { useEffect } from 'react';

import { AdminRouter } from '@/features/admin/router';
import { onPlatformSignedOut } from '@/features/admin/authed';
import { isPlatformHost } from '@/features/admin/supportHandoff';
import { onSignedOut } from '@/lib/api/authed';
import { initOfflineSync } from '@/lib/offline/sync';

import { AppProviders } from './providers';
import { AppRouter } from './router';

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

  return <AppProviders>{platformHost ? <AdminRouter /> : <AppRouter />}</AppProviders>;
}
