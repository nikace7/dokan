import { create } from 'zustand';

/**
 * Session revocation signal. TanStack Query's `clear()` removes cached
 * queries but mounted observers keep their last result, so route guards
 * never re-render on sign out. Bumping `rev` re-renders every useAuth /
 * usePlatformAuth consumer, and the guard's `hasTokens()` check (already
 * false by then) redirects to the login page immediately.
 */
export const useAuthSession = create<{ rev: number; bump: () => void }>((set) => ({
  rev: 0,
  bump: () => set((state) => ({ rev: state.rev + 1 })),
}));
