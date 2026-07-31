import { useEffect } from 'react';

import { onSignedOut } from '@/lib/api/authed';

import { AppProviders } from './providers';
import { AppRouter } from './router';

export default function App() {
  useEffect(
    // A 401 that even a token refresh can't fix means the session is dead
    // (revoked, tenant-claim mismatch, expired refresh). Tokens are already
    // cleared by authedRequest; a full navigation also drops in-memory
    // state (router, query cache) belonging to the old session.
    () => onSignedOut(() => window.location.assign('/login')),
    [],
  );

  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
