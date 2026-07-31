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
