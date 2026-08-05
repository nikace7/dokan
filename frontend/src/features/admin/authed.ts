import { ApiError, apiRequest, apiRequestPage } from '@/lib/api/client';
import type { Page, RequestOptions } from '@/lib/api/client';
import {
  clearPlatformTokens,
  getPlatformAccessToken,
  getPlatformRefreshToken,
  setPlatformTokens,
} from '@/features/admin/tokens';

interface RefreshResponse {
  access: string;
  refresh?: string;
}

const signedOutListeners = new Set<() => void>();
let refreshPromise: Promise<boolean> | null = null;

export function onPlatformSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

function notifySignedOut(): void {
  signedOutListeners.forEach((listener) => listener());
}

async function refreshPlatformTokens(): Promise<boolean> {
  const refresh = getPlatformRefreshToken();
  if (!refresh) return false;
  try {
    const data = await apiRequest<RefreshResponse>('/v1/admin/auth/token/refresh', {
      method: 'POST',
      body: { refresh },
    });
    setPlatformTokens({ access: data.access, refresh: data.refresh ?? refresh });
    return true;
  } catch {
    return false;
  }
}

function refreshOnce(): Promise<boolean> {
  refreshPromise ??= refreshPlatformTokens().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function withPlatformAuth<T>(
  call: (options: RequestOptions) => Promise<T>,
  options: RequestOptions,
): Promise<T> {
  try {
    return await call({ ...options, accessToken: getPlatformAccessToken() ?? undefined });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !(await refreshOnce())) {
      if (error instanceof ApiError && error.status === 401) {
        clearPlatformTokens();
        notifySignedOut();
      }
      throw error;
    }
    try {
      return await call({ ...options, accessToken: getPlatformAccessToken() ?? undefined });
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) {
        clearPlatformTokens();
        notifySignedOut();
      }
      throw retryError;
    }
  }
}

export function platformRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return withPlatformAuth((request) => apiRequest<T>(path, request), options);
}

export function platformRequestPage<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Page<T>> {
  return withPlatformAuth((request) => apiRequestPage<T>(path, request), options);
}
