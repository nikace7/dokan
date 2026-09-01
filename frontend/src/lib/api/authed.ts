/**
 * Authenticated request wrapper.
 *
 * Adds the SimpleJWT access token to every call and, on a single 401,
 * refreshes the token pair once and retries. If the refresh itself fails
 * the session is dead: tokens are cleared and the signed-out listeners are
 * notified so the app can bounce to /login.
 *
 * Transport details (envelope, idempotency keys) stay in `client.ts`; this
 * module only owns the token lifecycle.
 */

import { ApiError, apiRequest, apiRequestBlob, apiRequestPage } from '@/lib/api/client';
import type { BinaryDownload, Page, RequestOptions } from '@/lib/api/client';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '@/lib/auth/tokens';

interface RefreshResponse {
  access: string;
  /** Present because refresh tokens rotate (SimpleJWT ROTATE_REFRESH_TOKENS). */
  refresh?: string;
}

type SignedOutListener = () => void;

const signedOutListeners = new Set<SignedOutListener>();

/** Register a callback fired when the session is unrecoverably expired. */
export function onSignedOut(listener: SignedOutListener): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

function notifySignedOut(): void {
  signedOutListeners.forEach((listener) => listener());
}

/** In-flight refresh dedupe: parallel 401s share one refresh round-trip. */
let refreshPromise: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) {
    return false;
  }
  try {
    const data = await apiRequest<RefreshResponse>('/v1/auth/token/refresh', {
      method: 'POST',
      body: { refresh },
    });
    setTokens({ access: data.access, refresh: data.refresh ?? refresh });
    return true;
  } catch {
    return false;
  }
}

function refreshTokensOnce(): Promise<boolean> {
  refreshPromise ??= refreshTokens().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/**
 * Like `apiRequest`, but authenticated. A 401 triggers exactly one refresh +
 * retry; a second 401 (or a failed refresh) clears the session.
 */
export async function authedRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return withAuthRetry((opts) => apiRequest<T>(path, opts), options);
}

/**
 * Authenticated variant of `apiRequestPage` for paginated list endpoints,
 * with the same refresh-once-on-401 behaviour as `authedRequest`.
 */
export async function authedRequestPage<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Page<T>> {
  return withAuthRetry((opts) => apiRequestPage<T>(path, opts), options);
}

/** Authenticated binary download with the standard refresh-once behavior. */
export async function authedDownload(
  path: string,
  options: RequestOptions = {},
): Promise<BinaryDownload> {
  return withAuthRetry((opts) => apiRequestBlob(path, opts), options);
}

async function withAuthRetry<T>(
  call: (options: RequestOptions) => Promise<T>,
  options: RequestOptions,
): Promise<T> {
  try {
    return await call({ ...options, accessToken: getAccessToken() ?? undefined });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) {
      throw err;
    }
    const refreshed = await refreshTokensOnce();
    if (!refreshed) {
      clearTokens();
      notifySignedOut();
      throw err;
    }
    try {
      return await call({ ...options, accessToken: getAccessToken() ?? undefined });
    } catch (retryErr) {
      if (retryErr instanceof ApiError && retryErr.status === 401) {
        clearTokens();
        notifySignedOut();
      }
      throw retryErr;
    }
  }
}
