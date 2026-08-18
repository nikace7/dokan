import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api/client';

/**
 * Server-state defaults. TanStack Query owns all server state; Zustand is
 * only for cart/UI state (see docs/ARCHITECTURE.md).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // POS screens must never show silently stale stock/prices, but we also
      // don't want refetch storms on window focus in a busy shop.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry client errors (4xx) — they will fail again by definition.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      // Mutations are idempotency-keyed where money moves (POST /sales,
      // /payments), so one automatic retry is safe there; views stay off.
      retry: 0,
    },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
