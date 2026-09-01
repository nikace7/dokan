import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { fetchMe, login, logoutCurrentSession } from '@/features/auth/api';
import type { MeUser } from '@/features/auth/api';
import { ApiError } from '@/lib/api/client';
import { clearTokens, getRefreshToken, hasTokens, setTokens } from '@/lib/auth/tokens';
import { useAuthSession } from '@/stores/authSession';

const ME_QUERY_KEY = ['auth', 'me'] as const;

export interface AuthState {
  user: MeUser | null;
  isAuthenticated: boolean;
  /** True while the first `/auth/me` of a stored session is in flight. */
  isRestoring: boolean;
  isLoggingIn: boolean;
  /** Human-readable login failure (server message verbatim), if any. */
  loginError: string | null;
  requiresOtp: boolean;
  signIn: (phone: string, password: string, otp?: string) => Promise<void>;
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
  // Every consumer re-renders when the session is revoked (signOut bumps).
  useAuthSession((state) => state.rev);
  const [otpChallengeId, setOtpChallengeId] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    enabled: hasTokens(),
    // Identity rarely changes; permissions land here too (used by UI gating).
    staleTime: 5 * 60_000,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: ({ phone, password, otp }: { phone: string; password: string; otp?: string }) =>
      login(
        phone,
        password,
        otpChallengeId && otp ? { challenge_id: otpChallengeId, otp } : undefined,
      ),
    onSuccess: async (tokens) => {
      setTokens(tokens);
      setOtpChallengeId(null);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'OTP_REQUIRED') {
        const challengeId = error.body?.details?.challenge_id;
        if (typeof challengeId === 'string') setOtpChallengeId(challengeId);
      }
    },
  });

  const signOut = () => {
    const refresh = getRefreshToken();
    if (refresh) void logoutCurrentSession(refresh).catch(() => undefined);
    clearTokens();
    // queryClient.clear() removes every query but active observers keep
    // their last result — the bump re-renders consumers so the route guard
    // sees the empty token store and redirects without a manual refresh.
    queryClient.clear();
    queryClient.setQueryData(ME_QUERY_KEY, null);
    useAuthSession.getState().bump();
  };

  const loginError =
    loginMutation.error instanceof ApiError && loginMutation.error.code === 'OTP_REQUIRED'
      ? null
      : loginMutation.error instanceof ApiError
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
    requiresOtp: otpChallengeId !== null,
    signIn: async (phone, password, otp) => {
      await loginMutation.mutateAsync({ phone, password, otp });
    },
    signOut,
  };
}
