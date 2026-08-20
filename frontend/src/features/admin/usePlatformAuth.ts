import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchPlatformMe, platformLogin } from '@/features/admin/api';
import type { PlatformUser } from '@/features/admin/api';
import { clearPlatformTokens, hasPlatformTokens, setPlatformTokens } from '@/features/admin/tokens';
import { ApiError } from '@/lib/api/client';
import { useAuthSession } from '@/stores/authSession';

const PLATFORM_ME_KEY = ['platform', 'auth', 'me'] as const;

export function usePlatformAuth(): {
  user: PlatformUser | null;
  isAuthenticated: boolean;
  isRestoring: boolean;
  isLoggingIn: boolean;
  loginError: string | null;
  signIn: (email: string, password: string, otp: string) => Promise<void>;
  signOut: () => void;
} {
  const queryClient = useQueryClient();
  // Re-render consumers on sign-out so RequirePlatformAuth redirects at once.
  useAuthSession((state) => state.rev);
  const me = useQuery({
    queryKey: PLATFORM_ME_KEY,
    queryFn: fetchPlatformMe,
    enabled: hasPlatformTokens(),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const login = useMutation({
    mutationFn: (values: { email: string; password: string; otp: string }) =>
      platformLogin(values.email, values.password, values.otp),
    onSuccess: async (tokens) => {
      setPlatformTokens(tokens);
      await queryClient.invalidateQueries({ queryKey: PLATFORM_ME_KEY });
    },
  });
  const signOut = () => {
    clearPlatformTokens();
    queryClient.clear();
    // Same observer caveat as the tenant signOut: force the guard to react.
    queryClient.setQueryData(PLATFORM_ME_KEY, null);
    useAuthSession.getState().bump();
  };
  const loginError =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'Could not reach the platform service.'
        : null;

  return {
    user: me.data ?? null,
    isAuthenticated: me.data !== undefined,
    isRestoring: hasPlatformTokens() && me.isPending,
    isLoggingIn: login.isPending,
    loginError,
    signIn: async (email, password, otp) => {
      await login.mutateAsync({ email, password, otp });
    },
    signOut,
  };
}
