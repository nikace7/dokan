/**
 * Stable import path for the auth hook. The implementation lives in the
 * auth feature (`features/auth/useAuth.ts`); re-exported here so app-level
 * plumbing (layout, guards) has a feature-agnostic entry point.
 */
export { useAuth } from '@/features/auth/useAuth';
export type { AuthState } from '@/features/auth/useAuth';
