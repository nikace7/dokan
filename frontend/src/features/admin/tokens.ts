const ACCESS_KEY = 'dokan.platform.access';
const REFRESH_KEY = 'dokan.platform.refresh';

export interface PlatformTokens {
  access: string;
  refresh: string;
  token_type?: string;
}

export function getPlatformAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getPlatformRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function hasPlatformTokens(): boolean {
  return getPlatformAccessToken() !== null || getPlatformRefreshToken() !== null;
}

export function setPlatformTokens(tokens: PlatformTokens): void {
  localStorage.setItem(ACCESS_KEY, tokens.access);
  localStorage.setItem(REFRESH_KEY, tokens.refresh);
}

export function clearPlatformTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}
