import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';
import type { RateType } from '@/features/settings/api';

export type PriceScope = 'VARIANT' | 'ITEM' | 'CATEGORY';

export interface ItemPrice {
  id: string;
  rate_type: string;
  rate_type_code: string;
  scope: PriceScope;
  variant: string | null;
  item: string | null;
  category: string | null;
  /** Server-resolved "Item · SKU" / name — prefer over the raw FK ids. */
  target_label?: string | null;
  price: string;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PriceChange {
  id: string;
  target_type: PriceScope;
  target_id: string;
  /** Server-resolved target name — prefer over the raw UUID. */
  target_label?: string | null;
  rate_type: string | null;
  rate_type_code: string | null;
  old_price: string | null;
  new_price: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  reason: string | null;
  created_at: string;
}

export interface RateTypePayload {
  code: string;
  name: string;
  name_np?: string | null;
  is_default: boolean;
  sort_order: number;
  default_margin_pct?: string | null;
  required_permission?: string | null;
}

export interface SetPricePayload {
  rate_type: string;
  scope: PriceScope;
  variant?: string;
  item?: string;
  category?: string;
  price: string;
  effective_from: string;
  effective_to?: string | null;
  reason?: string;
}

function query(values: Record<string, string | boolean | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const result = params.toString();
  return result ? `?${result}` : '';
}

export function listPricingRateTypes(isActive?: boolean): Promise<Page<RateType>> {
  return authedRequestPage<RateType>(
    `/v1/pricing/rate-types${query({ is_active: isActive, limit: 200 })}`,
  );
}

export function createRateType(payload: RateTypePayload): Promise<RateType> {
  return authedRequest<RateType>('/v1/pricing/rate-types', { method: 'POST', body: payload });
}

export function updateRateType(id: string, payload: Partial<RateTypePayload>): Promise<RateType> {
  return authedRequest<RateType>(`/v1/pricing/rate-types/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}

export function deactivateRateType(id: string): Promise<{ id: string; is_active: boolean }> {
  return authedRequest(`/v1/pricing/rate-types/${id}`, { method: 'DELETE' });
}

export function listPrices(
  filters: {
    rateType?: string;
    scope?: PriceScope | '';
    page?: number;
  } = {},
): Promise<Page<ItemPrice>> {
  return authedRequestPage<ItemPrice>(
    `/v1/pricing/prices${query({
      rate_type: filters.rateType,
      scope: filters.scope,
      page: filters.page,
      limit: 50,
    })}`,
  );
}

export function setPrice(payload: SetPricePayload): Promise<ItemPrice> {
  return authedRequest<ItemPrice>('/v1/pricing/prices', { method: 'POST', body: payload });
}

export function listPriceChanges(page = 1): Promise<Page<PriceChange>> {
  return authedRequestPage<PriceChange>(`/v1/pricing/changes${query({ page, limit: 50 })}`);
}

export function setPriceBounds(
  targetKind: 'item' | 'variant',
  id: string,
  payload: { min_selling_price: string | null; max_selling_price: string | null },
): Promise<{ id: string; min_selling_price: string | null; max_selling_price: string | null }> {
  return authedRequest(`/v1/pricing/bounds/${targetKind}/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}
