/**
 * Catalog endpoints (items, variants, categories, brands, size charts).
 *
 * Shapes follow `apps/catalog/serializers.py`. Regenerate the typed client
 * (`npm run api:gen`) once the schema endpoint is published and drop these
 * local types. `avg_cost` is present on variants only when the user holds
 * `pricing.view_cost` — the backend drops it otherwise (invariant 10).
 */

import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';

export interface Category {
  id: string;
  parent: string | null;
  name: string;
  name_np: string | null;
  size_chart: string | null;
  default_margin_pct: string | null;
  min_price_pct: string | null;
  max_price_pct: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Brand {
  id: string;
  name: string;
  is_active: boolean;
}

export interface SizeChart {
  id: string;
  name: string;
  values: string[];
  is_active: boolean;
}

export type Gender = 'M' | 'F' | 'U' | 'KIDS';

export interface Item {
  id: string;
  code: string;
  name: string;
  name_np: string | null;
  category: string | null;
  brand: string | null;
  size_chart: string | null;
  gender: Gender | null;
  season: string | null;
  collection_tag: string | null;
  hsn_code: string | null;
  unit: string;
  is_vat_applicable: boolean;
  /** Absolute API path of the item photo (`/media/tenants/…`), null when unset. */
  image_url: string | null;
  min_selling_price: string | null;
  max_selling_price: string | null;
  reorder_level: string | null;
  is_active: boolean;
}

/** Writable subset of `ItemSerializer` (images/attributes stay server-side). */
export interface ItemPayload {
  code: string;
  name: string;
  name_np?: string | null;
  category?: string | null;
  brand?: string | null;
  size_chart?: string | null;
  gender?: Gender | null;
  season?: string | null;
  collection_tag?: string | null;
  hsn_code?: string | null;
  unit?: string;
  is_vat_applicable?: boolean;
  min_selling_price?: string | null;
  max_selling_price?: string | null;
  reorder_level?: string | null;
}

export interface ItemVariant {
  id: string;
  item: string;
  size: string;
  color: string;
  color_hex: string | null;
  sku: string;
  barcode: string | null;
  mrp: string;
  min_selling_price: string | null;
  max_selling_price: string | null;
  /** Only present for users with `pricing.view_cost` — never assume it. */
  avg_cost?: string;
  is_active: boolean;
}

export interface VariantBulkResult {
  created_count: number;
  skipped_count: number;
  created: ItemVariant[];
  /** Size/colour pairs the server skipped (already exist). */
  skipped: Array<{ size: string; color: string; reason: string }>;
}

export interface ItemListFilters {
  search?: string;
  category?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function listItems(filters: ItemListFilters = {}): Promise<Page<Item>> {
  return authedRequestPage<Item>(
    `/v1/catalog/items${qs({
      search: filters.search,
      category: filters.category,
      is_active: filters.isActive,
      page: filters.page,
      limit: filters.limit ?? 25,
    })}`,
  );
}

export function getItem(id: string): Promise<Item> {
  return authedRequest<Item>(`/v1/catalog/items/${id}`);
}

/** Accepted item-photo types and size cap — mirrored in the form's client-side checks. */
export const ITEM_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const ITEM_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Upload/replace the item photo (`POST /catalog/items/<id>/image`, multipart
 * field `image`). Returns the updated item. FormData bodies pass through the
 * client untouched so the browser sets the multipart boundary.
 */
export function uploadItemImage(id: string, file: File): Promise<Item> {
  const body = new FormData();
  body.append('image', file);
  return authedRequest<Item>(`/v1/catalog/items/${id}/image`, { method: 'POST', body });
}

/** Remove the item photo. Returns the updated item (image_url null). */
export function removeItemImage(id: string): Promise<Item> {
  return authedRequest<Item>(`/v1/catalog/items/${id}/image`, { method: 'DELETE' });
}

export function createItem(payload: ItemPayload): Promise<Item> {
  return authedRequest<Item>('/v1/catalog/items', { method: 'POST', body: payload });
}

export function updateItem(id: string, payload: Partial<ItemPayload>): Promise<Item> {
  return authedRequest<Item>(`/v1/catalog/items/${id}`, { method: 'PATCH', body: payload });
}

/** Deactivate (soft delete) — the delete endpoint flips `is_active`. */
export function deactivateItem(id: string): Promise<{ id: string; is_active: boolean }> {
  return authedRequest(`/v1/catalog/items/${id}`, { method: 'DELETE' });
}

export function listVariants(itemId: string): Promise<Page<ItemVariant>> {
  return authedRequestPage<ItemVariant>(
    `/v1/catalog/variants${qs({ item: itemId, is_active: true, limit: 200 })}`,
  );
}

export function bulkCreateVariants(
  itemId: string,
  payload: { sizes: string[]; colors: string[]; mrp?: string },
): Promise<VariantBulkResult> {
  return authedRequest<VariantBulkResult>(`/v1/catalog/items/${itemId}/variants/bulk`, {
    method: 'POST',
    body: payload,
  });
}

/** One-shot "Add product" payload — item + size×colour variants + optional opening stock. */
export interface QuickCreateProductPayload {
  code: string;
  name: string;
  name_np?: string | null;
  category?: string | null;
  brand?: string | null;
  size_chart?: string | null;
  gender?: Gender | null;
  season?: string | null;
  collection_tag?: string | null;
  hsn_code?: string | null;
  unit?: string;
  is_vat_applicable?: boolean;
  min_selling_price?: string | null;
  max_selling_price?: string | null;
  reorder_level?: string | null;
  sizes: string[];
  colors: string[];
  mrp?: string | null;
  /** Sent only when at least one quantity was entered; needs `stock.adjust`. */
  stock?: {
    branch: string;
    unit_cost: string;
    note: string;
    /** `"<size>::<color>"` keys with decimal-string quantities. */
    quantities: Record<string, string>;
  };
}

export interface QuickCreateProductResult {
  item: Item;
  variants: ItemVariant[];
  variants_created: number;
  stock_movements: number;
}

export function quickCreateProduct(
  payload: QuickCreateProductPayload,
): Promise<QuickCreateProductResult> {
  return authedRequest<QuickCreateProductResult>('/v1/catalog/products/quick-create', {
    method: 'POST',
    body: payload,
  });
}

export function listCategories(): Promise<Page<Category>> {
  return authedRequestPage<Category>(`/v1/catalog/categories${qs({ limit: 200 })}`);
}

export function createCategory(payload: {
  name: string;
  name_np?: string;
  size_chart?: string | null;
}): Promise<Category> {
  return authedRequest<Category>('/v1/catalog/categories', { method: 'POST', body: payload });
}

export function listBrands(): Promise<Page<Brand>> {
  return authedRequestPage<Brand>(`/v1/catalog/brands${qs({ limit: 200 })}`);
}

export function createBrand(payload: { name: string }): Promise<Brand> {
  return authedRequest<Brand>('/v1/catalog/brands', { method: 'POST', body: payload });
}

export function listSizeCharts(): Promise<Page<SizeChart>> {
  return authedRequestPage<SizeChart>(`/v1/catalog/size-charts${qs({ limit: 200 })}`);
}

export function createSizeChart(payload: { name: string; values: string[] }): Promise<SizeChart> {
  return authedRequest<SizeChart>('/v1/catalog/size-charts', { method: 'POST', body: payload });
}

/** Item search used by the shared VariantPicker (name or code, first page). */
export function searchItems(search: string): Promise<Page<Item>> {
  return authedRequestPage<Item>(`/v1/catalog/items${qs({ search, is_active: true, limit: 10 })}`);
}
