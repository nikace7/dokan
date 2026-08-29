/**
 * Storefront API client — same-origin, anonymous, read-only.
 *
 * Every endpoint answers the Dokan envelope:
 *   success: { data: T, meta?: {...}, error: null }
 *   failure: { data: null, error: { code, message } }  (non-2xx)
 */

export interface SiteCategory {
  id: string;
  name: string;
  name_np: string | null;
  product_count: number;
}

export interface SiteContact {
  phone: string | null;
  address: string | null;
}

export interface SiteInfo {
  shop_name: string;
  shop_name_np: string | null;
  currency: 'NPR' | 'INR';
  template: string;
  contact: SiteContact;
  categories: SiteCategory[];
}

export interface Product {
  id: string;
  code: string;
  name: string;
  name_np: string | null;
  image: string | null;
  category: string | null;
  brand: string | null;
  price_min: string | null;
  price_max: string | null;
  in_stock: boolean;
}

export interface PageMeta {
  count: number;
  page: number;
  total_pages: number;
  page_size: number;
}

export interface ProductsPage {
  data: Product[];
  meta: PageMeta | null;
}

interface ErrorBody {
  code: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
  }
}

function isEnvelope(value: unknown): value is { data: unknown; error: ErrorBody | null } {
  return typeof value === 'object' && value !== null && ('data' in value || 'error' in value);
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const parsed: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body: ErrorBody =
      isEnvelope(parsed) && parsed.error
        ? parsed.error
        : { code: 'REQUEST_FAILED', message: `Request failed (${response.status}).` };
    throw new ApiError(response.status, body);
  }
  if (isEnvelope(parsed)) {
    if (parsed.error) {
      throw new ApiError(response.status, parsed.error);
    }
    return parsed.data as T;
  }
  throw new ApiError(response.status, {
    code: 'BAD_RESPONSE',
    message: 'The store returned an unexpected response.',
  });
}

export function getSite(): Promise<SiteInfo> {
  return request<SiteInfo>('/api/v1/storefront/site');
}

export async function getProducts(params: {
  category?: string;
  q?: string;
  page?: number;
}): Promise<ProductsPage> {
  const search = new URLSearchParams();
  if (params.category) search.set('category', params.category);
  if (params.q) search.set('q', params.q);
  if (params.page && params.page > 1) search.set('page', String(params.page));
  const suffix = search.toString();
  const path = `/api/v1/storefront/products${suffix ? `?${suffix}` : ''}`;

  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body: ErrorBody =
      isEnvelope(parsed) && parsed.error
        ? parsed.error
        : { code: 'REQUEST_FAILED', message: `Request failed (${response.status}).` };
    throw new ApiError(response.status, body);
  }
  if (!isEnvelope(parsed) || parsed.error) {
    throw new ApiError(response.status, {
      code: 'BAD_RESPONSE',
      message: 'The store returned an unexpected response.',
    });
  }
  const meta = (parsed as { meta?: unknown }).meta;
  return {
    data: (parsed.data ?? []) as Product[],
    meta: meta && typeof meta === 'object' && 'count' in meta ? (meta as PageMeta) : null,
  };
}
