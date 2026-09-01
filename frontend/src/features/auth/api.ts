/**
 * Auth endpoints (accounts app).
 *
 * Request and response shapes come from the generated OpenAPI declaration.
 */

import { apiRequest } from '@/lib/api/client';
import { authedRequest } from '@/lib/api/authed';
import { getAccessToken, getDeviceIdentity } from '@/lib/auth/tokens';
import type { components } from '@/lib/api/schema';

/** `GET /auth/me` payload — `MeSerializer`. */
type GeneratedMe = components['schemas']['Me'];
export interface MeUser extends Omit<GeneratedMe, 'plan' | 'currency'> {
  plan: {
    code: string;
    name: string;
    features: Record<string, unknown>;
  };
  currency: 'NPR' | 'INR';
}

export type AuthTokens = components['schemas']['TokenPair'];
export type AuthSession = components['schemas']['AuthSession'];
export type LoginOtpStatus = components['schemas']['LoginOtpStatus'];
type Accepted = components['schemas']['Accepted'];
type PasswordResetRequest = components['schemas']['PasswordResetRequest'];
type PasswordResetConfirm = components['schemas']['PasswordResetConfirm'];
type PasswordChange = components['schemas']['PasswordChange'];

/** `POST /auth/token` — phone + password, scoped to the host's tenant. */
export function login(
  phone: string,
  password: string,
  challenge?: { challenge_id: string; otp: string },
): Promise<AuthTokens> {
  const body: components['schemas']['TokenObtain'] = {
    phone,
    password,
    ...getDeviceIdentity(),
    ...challenge,
  };
  return apiRequest<AuthTokens>('/v1/auth/token', {
    method: 'POST',
    body,
  });
}

/** Current user + resolved permission codenames. */
export function fetchMe(): Promise<MeUser> {
  return authedRequest<MeUser>('/v1/auth/me');
}

export function requestPasswordReset(body: PasswordResetRequest): Promise<Accepted> {
  return apiRequest<Accepted>('/v1/auth/password-reset/request', { method: 'POST', body });
}

export function confirmPasswordReset(body: PasswordResetConfirm): Promise<Accepted> {
  return apiRequest<Accepted>('/v1/auth/password-reset/confirm', { method: 'POST', body });
}

export function changePassword(body: PasswordChange): Promise<Accepted> {
  return authedRequest<Accepted>('/v1/auth/password/change', { method: 'POST', body });
}

export function logoutCurrentSession(refresh: string): Promise<Accepted> {
  return apiRequest<Accepted>('/v1/auth/logout', {
    method: 'POST',
    body: { refresh },
    accessToken: getAccessToken() ?? undefined,
  });
}

export function getLoginOtpStatus(): Promise<LoginOtpStatus> {
  return authedRequest<LoginOtpStatus>('/v1/auth/login-otp');
}

export function requestLoginOtp(): Promise<Accepted> {
  return authedRequest<Accepted>('/v1/auth/login-otp/request', { method: 'POST' });
}

export function confirmLoginOtp(code: string): Promise<LoginOtpStatus> {
  return authedRequest<LoginOtpStatus>('/v1/auth/login-otp/confirm', {
    method: 'POST',
    body: { code },
  });
}

export function disableLoginOtp(currentPassword: string): Promise<LoginOtpStatus> {
  return authedRequest<LoginOtpStatus>('/v1/auth/login-otp', {
    method: 'DELETE',
    body: { current_password: currentPassword },
  });
}

export function listAuthSessions(): Promise<AuthSession[]> {
  return authedRequest<AuthSession[]>('/v1/auth/sessions');
}

export function revokeAuthSession(id: string): Promise<AuthSession> {
  return authedRequest<AuthSession>(`/v1/auth/sessions/${id}/revoke`, { method: 'POST' });
}

export function revokeOtherAuthSessions(): Promise<{ revoked_count: number }> {
  return authedRequest<{ revoked_count: number }>('/v1/auth/sessions/revoke-others', {
    method: 'POST',
  });
}
