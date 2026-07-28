import { useState } from 'react';

import type { PermissionUser } from '@/lib/permissions';

/**
 * Auth stub.
 *
 * Real auth (phone + password → SimpleJWT access/refresh, rotating refresh,
 * token bound to one tenant subdomain) lands with the accounts feature.
 * Until then this returns an unauthenticated state and a no-op signOut so
 * layout and permission plumbing can be built against a stable interface.
 */
export interface AuthState {
  user: (PermissionUser & { id: string; name: string }) | null;
  isAuthenticated: boolean;
  signOut: () => void;
}

export function useAuth(): AuthState {
  const [user] = useState<AuthState['user']>(null);
  return {
    user,
    isAuthenticated: user !== null,
    signOut: () => {
      // TODO(accounts feature): POST /auth/logout, drop tokens, clear query cache.
    },
  };
}
