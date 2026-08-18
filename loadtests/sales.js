/**
 * Load test: POST /api/v1/sales at 50 rps (docs/ARCHITECTURE.md testing-strategy target).
 *
 * Each iteration completes a one-line CASH sale with a unique Idempotency-Key
 * (invariant 8). setup() logs in once, resolves the default branch / rate
 * type / variant, and opens a cash session if none is open (invariant 12).
 *
 * PREREQUISITE: completed sales consume stock. The seed only loads 20 units
 * per variant, which 50 rps burns through instantly — boost stock first with
 * the snippet in README.md, or the run fails on STOCK_INSUFFICIENT.
 *
 * Run:
 *   k6 run --hosts demo.localhost=127.0.0.1 loadtests/sales.js
 */

import http from 'k6/http';
import { check, fail } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { authHeaders, BASE_URL, getJson, login } from './lib/dokan.js';

const SKU = __ENV.LOAD_SKU || 'TEE-01-M-BLACK';
const RATE = Number(__ENV.LOAD_RPS || 50);
const DURATION = __ENV.LOAD_DURATION || '1m';

export const options = {
  // Caddy's local edge uses its internal CA.
  insecureSkipTLSVerify: true,
  scenarios: {
    create_sale: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(10, Math.ceil(RATE / 2)),
      maxVUs: Math.max(50, RATE * 2),
      exec: 'createSale',
    },
  },
  thresholds: {
    // Sale writes go through row locks + gapless numbering; give the write
    // path more headroom than reads, but p95 must stay sub-second.
    'http_req_duration{endpoint:create_sale}': ['p(95)<800'],
    'http_req_failed{endpoint:create_sale}': ['rate<0.01'],
  },
};

export function setup() {
  const token = login();

  const branches = getJson(token, '/api/v1/branches?is_active=true&limit=200', 'branches');
  const branch = branches.find((b) => b.is_default) || branches[0];
  if (!branch) fail('no active branch — is the demo tenant seeded?');

  const rateTypes = getJson(token, '/api/v1/pricing/rate-types?is_active=true&limit=200', 'rate_types');
  const rateType = rateTypes.find((r) => r.is_default) || rateTypes[0];
  if (!rateType) fail('no active rate type — is the demo tenant seeded?');

  const variant = getJson(
    token,
    `/api/v1/catalog/variants/lookup?sku=${encodeURIComponent(SKU)}`,
    'variant_lookup',
  );

  const current = getJson(
    token,
    `/api/v1/cash-sessions/current?branch=${branch.id}`,
    'cash_session',
  );
  if (!current.session) {
    const opened = http.post(
      `${BASE_URL}/api/v1/cash-sessions/open`,
      JSON.stringify({ branch: branch.id, opening_float: '1000.00', note: 'k6 load test' }),
      { headers: authHeaders(token), tags: { endpoint: 'cash_session' } },
    );
    if (opened.status !== 201) {
      fail(`could not open cash session (HTTP ${opened.status}): ${opened.body}`);
    }
  }

  const unitPrice = Number(variant.mrp);
  return {
    token,
    branchId: branch.id,
    rateTypeId: rateType.id,
    variantId: variant.id,
    total: unitPrice.toFixed(2),
  };
}

export function createSale(ctx) {
  const payload = JSON.stringify({
    branch: ctx.branchId,
    rate_type: ctx.rateTypeId,
    lines: [{ variant: ctx.variantId, qty: '1', discount: '0' }],
    payments: [{ method: 'CASH', amount: ctx.total }],
    is_vat_bill: false,
    device_id: 'k6-load-test',
  });
  const res = http.post(`${BASE_URL}/api/v1/sales`, payload, {
    headers: {
      ...authHeaders(ctx.token),
      // Unique per iteration: a replay (200) only happens on genuine retries.
      'Idempotency-Key': `k6-sale-${__VU}-${__ITER}-${uuidv4()}`,
    },
    tags: { endpoint: 'create_sale' },
  });
  check(res, {
    'sale created (201)': (r) => r.status === 201,
    'not stock-blocked (boost stock — see README)': (r) =>
      r.status === 201 || !String(r.body).includes('STOCK_INSUFFICIENT'),
  });
}
