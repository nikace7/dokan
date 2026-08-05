/**
 * Token storage for SimpleJWT access/refresh tokens.
 *
 * Tokens live in localStorage for now, which is readable by any JS running
 * on the origin (XSS exposure). TODO(security hardening): move the refresh
 * token to an httpOnly, SameSite=strict cookie set by the backend and keep
 * only the short-lived access token in memory; the client already sends
 * `credentials: 'include'` so the switch is server-side only.
 */

const ACCESS_KEY = 'dokan.access';
const REFRESH_KEY = 'dokan.refresh';

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface ImpersonationClaims {
  act: string;
  jti: string;
  scope: 'read_only' | 'read_write';
  exp: number;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function hasTokens(): boolean {
  return getAccessToken() !== null || getRefreshToken() !== null;
}

export function setTokens(tokens: AuthTokens): void {
  localStorage.setItem(ACCESS_KEY, tokens.access);
  localStorage.setItem(REFRESH_KEY, tokens.refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getImpersonationClaims(): ImpersonationClaims | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const raw = token.split('.')[1];
    if (!raw) return null;
    const base64 = raw
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(raw.length / 4) * 4, '=');
    const claims = JSON.parse(atob(base64)) as Partial<ImpersonationClaims>;
    return typeof claims.act === 'string' &&
      typeof claims.jti === 'string' &&
      (claims.scope === 'read_only' || claims.scope === 'read_write') &&
      typeof claims.exp === 'number'
      ? (claims as ImpersonationClaims)
      : null;
  } catch {
    return null;
  }
}
