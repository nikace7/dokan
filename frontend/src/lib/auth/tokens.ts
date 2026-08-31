/**
 * Token storage for SimpleJWT access/refresh tokens.
 *
 * Tokens follow ADR 0001's bearer-token decision. A separate non-secret,
 * stable device UUID lets the backend replace a previous session when the
 * same browser signs in again.
 */

const ACCESS_KEY = 'dokan.access';
const REFRESH_KEY = 'dokan.refresh';
const DEVICE_ID_KEY = 'dokan.device-id';

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

export function setAccessToken(access: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.removeItem(REFRESH_KEY);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export interface DeviceIdentity {
  device_id: string;
  device_name: string;
}

export function getDeviceIdentity(): DeviceIdentity {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  const agent = navigator.userAgent;
  const kind = /android|iphone|ipad|mobile/i.test(agent) ? 'Mobile device' : 'Web browser';
  return { device_id: deviceId, device_name: kind };
}

export function parseImpersonationClaims(token: string): ImpersonationClaims | null {
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

export function getImpersonationClaims(): ImpersonationClaims | null {
  const token = getAccessToken();
  return token ? parseImpersonationClaims(token) : null;
}
