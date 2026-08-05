/**
 * Shared environment configuration for the E2E suite.
 *
 * Targets (see README.md):
 * - Compose stack (default): E2E_BASE_URL=https://demo.localhost (Caddy edge,
 *   internal CA — the config sets ignoreHTTPSErrors), API helpers talk to the
 *   backend directly at E2E_API_URL=http://127.0.0.1:8000 with the tenant
 *   passed via the Host header (tenant comes only from the host — invariant 4).
 * - Vite dev server: E2E_BASE_URL=http://localhost:5173 (its /api proxy
 *   rewrites the Host header to the demo tenant for the browser); the API
 *   helpers still use E2E_API_URL + Host header.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'https://demo.localhost';
const baseHost = new URL(baseURL).hostname;

/** Host header / SNI the tenant is resolved from. */
const tenantHost =
  process.env.E2E_TENANT_HOST ??
  (baseHost === 'localhost' || baseHost === '127.0.0.1' ? 'demo.localhost' : baseHost);

export const config = {
  baseURL,
  /** Direct backend origin used by test-setup API calls. */
  apiURL: process.env.E2E_API_URL ?? 'http://127.0.0.1:8000',
  tenantHost,
  phone: process.env.E2E_PHONE ?? '9800000000',
  password: process.env.E2E_PASSWORD ?? 'demo1234',
} as const;
