import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchMe, login } from '@/features/auth/api';
import type { MeUser } from '@/features/auth/api';
import { ApiError } from '@/lib/api/client';
import { clearTokens, hasTokens, setTokens } from '@/lib/auth/tokens';

const ME_QUERY_KEY = ['auth', 'me'] as const;

export interface AuthState {
  user: MeUser | null;
  isAuthenticated: boolean;
  /** True while the first `/auth/me` of a stored session is in flight. */
  isRestoring: boolean;
  isLoggingIn: boolean;
  /** Human-readable login failure (server message verbatim), if any. */
  loginError: string | null;
  signIn: (phone: string, password: string) => Promise<void>;
  signOut: () => void;
}

/**
 * Auth state for the whole app.
 *
 * The access/refresh pair lives in `lib/auth/tokens`; server truth about
 * the user lives in TanStack Query (`/auth/me`). A stored token pair means
 * "maybe authenticated" until `/auth/me` confirms it — `isRestoring`
 * covers that gap so route guards don't flash the login page.
 */
export function useAuth(): AuthState {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    enabled: hasTokens(),
    // Identity rarely changes; permissions land here too (used by UI gating).
    staleTime: 5 * 60_000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: ({ phone, password }: { phone: string; password: string }) =>
      login(phone, password),
    onSuccess: async (tokens) => {
      setTokens(tokens);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });

  const signOut = () => {
    clearTokens();
    // Drop every cached query: server state is tenant- and user-scoped.
    queryClient.clear();
  };

  const loginError =
    loginMutation.error instanceof ApiError
      ? loginMutation.error.message
      : loginMutation.error
        ? 'Could not reach the server. Check your connection and try again.'
        : null;

  return {
    user: meQuery.data ?? null,
    isAuthenticated: meQuery.data != null,
    isRestoring: hasTokens() && meQuery.isPending,
    isLoggingIn: loginMutation.isPending,
    loginError,
    signIn: async (phone, password) => {
      await loginMutation.mutateAsync({ phone, password });
    },
    signOut,
  };
}
