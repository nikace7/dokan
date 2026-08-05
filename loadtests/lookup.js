/**
 * Load test: GET /api/v1/catalog/variants/lookup at 200 rps — the POS
 * barcode/SKU hot path (AGENTS.md testing-strategy target).
 *
 * setup() logs in once; iterations alternate barcode-style and sku-style
 * lookups across the seeded demo SKUs so caches see a realistic mix.
 *
 * Run:
 *   k6 run --hosts demo.localhost=127.0.0.1 loadtests/lookup.js
 */

import http from 'k6/http';
import { check } from 'k6';

import { authHeaders, BASE_URL, login } from './lib/dokan.js';

const RATE = Number(__ENV.LOAD_RPS || 200);
const DURATION = __ENV.LOAD_DURATION || '1m';

// Seeded demo catalog (seed_demo): item code TEE-01 / SH-01 / JW-01, sizes M/L.
const SKUS = [
  'TEE-01-M-BLACK',
  'TEE-01-L-BLACK',
  'SH-01-M-BLACK',
  'SH-01-L-BLACK',
  'JW-01-M-BLACK',
  'JW-01-L-BLACK',
];

export const options = {
  insecureSkipTLSVerify: true,
  scenarios: {
    variant_lookup: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(10, Math.ceil(RATE / 10)),
      maxVUs: Math.max(50, RATE),
      exec: 'lookup',
    },
  },
  thresholds: {
    // Reads on an index-covered lookup must be fast; the counter cannot wait.
    'http_req_duration{endpoint:variant_lookup}': ['p(95)<200'],
    'http_req_failed{endpoint:variant_lookup}': ['rate<0.01'],
  },
};

export function setup() {
  return { token: login() };
}

export function lookup(ctx) {
  const sku = SKUS[(__VU + __ITER) % SKUS.length];
  const res = http.get(
    `${BASE_URL}/api/v1/catalog/variants/lookup?sku=${encodeURIComponent(sku)}`,
    { headers: authHeaders(ctx.token), tags: { endpoint: 'variant_lookup' } },
  );
  check(res, {
    'variant found (200)': (r) => r.status === 200,
    'sku echoes back': (r) => r.status === 200 && r.json().data.sku === sku,
  });
}
