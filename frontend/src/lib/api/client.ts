/**
 * Low-level fetch wrapper for the Django API.
 *
 * This is transport only. Endpoint paths, request bodies, and response types
 * come from the OpenAPI-generated client (`npm run api:gen`) once the backend
 * publishes its schema — hand-written endpoint types are forbidden
 * (docs/SYSTEM_DESIGN.md §8.4).
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/** Endpoints where a retry/double-tap must never create two records. */
const IDEMPOTENT_POST_PATHS = ['/v1/sales', '/v1/payments'] as const;

/** Matches the API error envelope: `{ data: null, error: {...} }`. */
export interface ApiErrorBody {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** Machine-readable code the UI branches on, e.g. PRICE_BELOW_MINIMUM. */
  get code(): string | null {
    return this.body?.code ?? null;
  }
}

interface ApiEnvelope<T> {
  data: T | null;
  meta?: Record<string, unknown>;
  error: ApiErrorBody | null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON body. Objects are stringified; pass FormData for uploads. */
  body?: unknown;
  /** Explicit idempotency key; auto-generated for POST /sales and /payments. */
  idempotencyKey?: string;
  /** Bearer access token (SimpleJWT). Auth wiring lands with useAuth. */
  accessToken?: string;
  signal?: AbortSignal;
  /** Observe response metadata such as usage-warning headers. */
  onResponse?: (response: Response) => void;
}

function newIdempotencyKey(): string {
  // crypto.randomUUID is available in all supported browsers + Node 20 (tests).
  return crypto.randomUUID();
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return typeof value === 'object' && value !== null && ('data' in value || 'error' in value);
}

/**
 * Perform one API request and unwrap the `{ data, meta, error }` envelope.
 * Throws `ApiError` on any non-2xx status or envelope-level error.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, accessToken, signal, onResponse } = options;

  const headers = new Headers({ Accept: 'application/json' });
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (body instanceof FormData) {
      payload = body;
    } else {
      headers.set('Content-Type', 'application/json');
      payload = JSON.stringify(body);
    }
  }

  if (method === 'POST') {
    const key =
      idempotencyKey ??
      (IDEMPOTENT_POST_PATHS.some((p) => path.startsWith(p)) ? newIdempotencyKey() : undefined);
    if (key) {
      // Mandatory on POST /sales and /payments: a double-tap on a flaky
      // connection must replay, not duplicate (AGENTS.md invariant 8).
      headers.set('Idempotency-Key', key);
    }
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: payload,
    // Refresh-token cookie (rotating) rides along; JWT access goes in the header.
    credentials: 'include',
    signal,
  });
  onResponse?.(response);

  const parsed: unknown = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody =
      isEnvelope(parsed) && parsed.error
        ? parsed.error
        : ({ message: response.statusText } as ApiErrorBody);
    throw new ApiError(response.status, errorBody);
  }

  if (isEnvelope(parsed)) {
    if (parsed.error) {
      throw new ApiError(response.status, parsed.error);
    }
    return parsed.data as T;
  }

  // Non-envelope responses (e.g. file downloads) are passed through untouched.
  return parsed as T;
}

/** Pagination block carried in the envelope `meta` of list endpoints. */
export interface PageMeta {
  count: number;
  page: number;
  total_pages: number;
  page_size: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta | null;
}

/**
 * Like `apiRequest`, but for paginated list endpoints: returns the page of
 * rows together with the envelope `meta` (count/page/total_pages).
 */
export async function apiRequestPage<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Page<T>> {
  const { method = 'GET', body, idempotencyKey, accessToken, signal, onResponse } = options;

  const headers = new Headers({ Accept: 'application/json' });
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }
  if (method === 'POST' && idempotencyKey) {
    headers.set('Idempotency-Key', idempotencyKey);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: payload,
    credentials: 'include',
    signal,
  });
  onResponse?.(response);

  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody =
      isEnvelope(parsed) && parsed.error
        ? parsed.error
        : ({ message: response.statusText } as ApiErrorBody);
    throw new ApiError(response.status, errorBody);
  }
  if (!isEnvelope(parsed) || parsed.error) {
    throw new ApiError(response.status, isEnvelope(parsed) ? parsed.error : null);
  }

  const meta = parsed.meta;
  return {
    data: (parsed.data ?? []) as T[],
    meta: meta && typeof meta.count === 'number' ? (meta as unknown as PageMeta) : null,
  };
}
