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

/** The offer popup, present only while enabled with some copy to show. */
export interface StorePopup {
  title: string;
  text: string;
  cta_text: string;
  cta_link: string;
}

/** One promo banner card between the hero and the grid. */
export interface StoreBanner {
  title: string;
  text: string;
  cta_text: string;
  cta_link: string;
}

/** Tenant-controlled website content (empty string / null = hidden). */
export interface StoreContent {
  hero_title: string;
  hero_subtitle: string;
  announcement: string;
  offer_text: string;
  /** Decimal string like "20.00", null when no store-wide offer. */
  offer_discount_pct: string | null;
  /** ISO date of the offer's last day, null when open-ended or lapsed. */
  offer_ends_at: string | null;
  popup: StorePopup | null;
  banners: StoreBanner[];
}

export interface SiteInfo {
  shop_name: string;
  shop_name_np: string | null;
  currency: 'NPR' | 'INR';
  template: string;
  contact: SiteContact;
  store: StoreContent;
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
  /** Single online-store price (already discounted when an offer runs). */
  website_price: string | null;
  /** Original website price, present only while an offer discounts it. */
  website_compare_at: string | null;
  /** The discount percent driving the price, for badge display. */
  offer_pct: string | null;
  /** Merchandised into the featured rail and sorted first in the grid. */
  featured: boolean;
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
  featured?: boolean;
}): Promise<ProductsPage> {
  const search = new URLSearchParams();
  if (params.category) search.set('category', params.category);
  if (params.q) search.set('q', params.q);
  if (params.featured) search.set('featured', '1');
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
