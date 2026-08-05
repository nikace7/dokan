/**
 * Shared configuration + login for the Dokan k6 load tests.
 *
 * The demo tenant is resolved from the Host header / SNI (invariant 4), so
 * the base URL must carry the tenant host: https://demo.localhost via the
 * Caddy edge. On machines where *.localhost does not resolve to the stack,
 * pass `--hosts demo.localhost=127.0.0.1` to k6 (see README.md).
 */

import http from 'k6/http';
import { fail } from 'k6';

export const BASE_URL = __ENV.LOAD_BASE_URL || 'https://demo.localhost';
export const PHONE = __ENV.LOAD_PHONE || '9800000000';
export const PASSWORD = __ENV.LOAD_PASSWORD || 'demo1234';

/** POST /api/v1/auth/token once per run (from setup()) and reuse the JWT. */
export function login() {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/token`,
    JSON.stringify({ phone: PHONE, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login' } },
  );
  if (res.status !== 200) {
    fail(`login failed (HTTP ${res.status}): ${res.body} — is seed_demo run on this stack?`);
  }
  const body = res.json();
  return body.data.access;
}

export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** GET helper that hard-fails setup on unexpected statuses. */
export function getJson(token, path, tag) {
  const res = http.get(`${BASE_URL}${path}`, {
    headers: authHeaders(token),
    tags: { endpoint: tag },
  });
  if (res.status !== 200) {
    fail(`GET ${path} failed (HTTP ${res.status}): ${res.body}`);
  }
  return res.json().data;
}
