/**
 * Minimal API client for test setup/teardown against the demo tenant.
 *
 * Uses Node's http/https directly (not page.request) so the tenant can be
 * passed via the Host header to the backend's direct port — *.localhost
 * resolution is unreliable on Windows (see playwright.config.ts).
 */

import http from 'node:http';
import https from 'node:https';

import { config } from '../config';

interface ApiEnvelope<T> {
  data: T;
  error: { code: string; message: string } | null;
}

interface Tokens {
  access: string;
  refresh: string;
}

export interface BranchInfo {
  id: string;
  code: string;
  is_default: boolean;
}

interface RateTypeInfo {
  id: string;
  code: string;
  is_default: boolean;
}

export interface VariantInfo {
  id: string;
  sku: string;
  mrp: string | number;
}

interface CashSessionInfo {
  id: string;
  branch: string;
}

export interface CreatedInvoice {
  id: string;
  invoice_no: number | null;
  total: string;
  status: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    path: string,
  ) {
    super(`${path} -> HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

export class DemoApi {
  accessToken = '';
  refreshToken = '';

  private rawRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<{ status: number; body: ApiEnvelope<T> }> {
    const url = new URL(config.apiURL);
    const transport = url.protocol === 'https:' ? https : http;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      Host: config.tenantHost,
      Accept: 'application/json',
      ...extraHeaders,
    };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      // Django/WSGI does not read chunked request bodies — send a length.
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path,
          method,
          headers,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: ApiEnvelope<T>;
            try {
              parsed = JSON.parse(text) as ApiEnvelope<T>;
            } catch {
              reject(new ApiError(res.statusCode ?? 0, text, path));
              return;
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const res = await this.rawRequest<T>(method, path, body, this.accessToken, extraHeaders);
    if (res.status >= 400) throw new ApiError(res.status, JSON.stringify(res.body), path);
    return res.body.data;
  }

  /** POST /api/v1/auth/token — phone+password login on the tenant host. */
  async login(): Promise<void> {
    const res = await this.rawRequest<Tokens>('POST', '/api/v1/auth/token', {
      phone: config.phone,
      password: config.password,
    });
    if (res.status !== 200 || !res.body.data?.access) {
      throw new ApiError(
        res.status,
        JSON.stringify(res.body),
        '/api/v1/auth/token (is seed_demo run on this stack?)',
      );
    }
    this.accessToken = res.body.data.access;
    this.refreshToken = res.body.data.refresh;
  }

  /** The tenant's default branch (MAIN in the seed). */
  async getDefaultBranch(): Promise<BranchInfo> {
    const branches = await this.request<BranchInfo[]>(
      'GET',
      '/api/v1/branches?is_active=true&limit=200',
    );
    const branch = branches.find((b) => b.is_default) ?? branches[0];
    if (!branch) throw new Error('No active branch found — is the demo tenant seeded?');
    return branch;
  }

  /** The tenant's default selling rate type (RETAIL in the seed). */
  async getDefaultRateType(): Promise<RateTypeInfo> {
    const rateTypes = await this.request<RateTypeInfo[]>(
      'GET',
      '/api/v1/pricing/rate-types?is_active=true&limit=200',
    );
    const rateType = rateTypes.find((r) => r.is_default) ?? rateTypes[0];
    if (!rateType) throw new Error('No active rate type found — is the demo tenant seeded?');
    return rateType;
  }

  /** GET /api/v1/catalog/variants/lookup?sku= — same endpoint the POS scans into. */
  async lookupVariantBySku(sku: string): Promise<VariantInfo> {
    return this.request<VariantInfo>(
      'GET',
      `/api/v1/catalog/variants/lookup?sku=${encodeURIComponent(sku)}`,
    );
  }

  /**
   * POS completion requires an open cash session for the branch
   * (invariant 12); open one if the seed/stack does not have one yet.
   */
  async ensureCashSession(branchId: string): Promise<string> {
    const current = await this.request<{ session: CashSessionInfo | null }>(
      'GET',
      `/api/v1/cash-sessions/current?branch=${branchId}`,
    );
    if (current.session) return current.session.id;
    const opened = await this.request<CashSessionInfo>('POST', '/api/v1/cash-sessions/open', {
      branch: branchId,
      opening_float: '1000.00',
      note: 'Opened by the E2E suite',
    });
    return opened.id;
  }

  /**
   * POST /api/v1/sales — a completed cash sale, used to set up return-flow
   * tests. Every call gets a fresh Idempotency-Key (invariant 8).
   */
  async createCashSale(input: {
    branchId: string;
    rateTypeId: string;
    variantId: string;
    qty: string;
    amount: string;
  }): Promise<CreatedInvoice> {
    return this.request<CreatedInvoice>(
      'POST',
      '/api/v1/sales',
      {
        branch: input.branchId,
        rate_type: input.rateTypeId,
        lines: [{ variant: input.variantId, qty: input.qty, discount: '0' }],
        payments: [{ method: 'CASH', amount: input.amount }],
        is_vat_bill: false,
      },
      { 'Idempotency-Key': crypto.randomUUID() },
    );
  }
}
