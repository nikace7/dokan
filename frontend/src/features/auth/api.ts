/**
 * Auth endpoints (accounts app).
 *
 * Shapes follow `apps/accounts/serializers.py`; regenerate the typed client
 * (`npm run api:gen`) once the schema endpoint is published and drop these
 * local types.
 */

import { apiRequest } from '@/lib/api/client';
import { authedRequest } from '@/lib/api/authed';
import type { AuthTokens } from '@/lib/auth/tokens';

/** `GET /auth/me` payload — `MeSerializer`. */
export interface MeUser {
  id: string;
  phone: string;
  full_name: string;
  email: string | null;
  must_change_password: boolean;
  permissions: string[];
  plan: {
    code: string;
    name: string;
    features: Record<string, unknown>;
  };
}

/** `POST /auth/token` — phone + password, scoped to the host's tenant. */
export function login(phone: string, password: string): Promise<AuthTokens> {
  return apiRequest<AuthTokens>('/v1/auth/token', {
    method: 'POST',
    body: { phone, password },
  });
}

/** Current user + resolved permission codenames. */
export function fetchMe(): Promise<MeUser> {
  return authedRequest<MeUser>('/v1/auth/me');
}
