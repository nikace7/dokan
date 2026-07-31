/**
 * Inventory endpoints (stock levels projection + opening stock write).
 *
 * Shapes follow `apps/inventory/serializers.py`. Cost fields (`avg_cost`)
 * arrive only when the user holds `pricing.view_cost` — the backend drops
 * them at both the selector and serializer layers (invariant 10).
 */

import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';

export interface StockLevel {
  id: string;
  branch: string;
  branch_code: string;
  variant: string;
  variant_sku: string;
  item_name: string;
  qty_on_hand: string;
  qty_reserved: string;
  /** Only present for users with `pricing.view_cost` — never assume it. */
  avg_cost?: string;
  updated_at: string;
}

export interface OpeningStockPayload {
  branch: string;
  variant: string;
  /** Decimal strings, e.g. "20" and "450.00". */
  qty: string;
  unit_cost: string;
  note?: string;
}

export interface StockMovement {
  id: string;
  branch: string;
  branch_code: string;
  variant: string;
  variant_sku: string;
  type: string;
  qty_delta: string;
  unit_cost?: string;
  balance_after: string;
  note: string;
  business_date_bs: string;
  fiscal_year_bs: string;
  created_at: string;
}

export interface LevelListFilters {
  branch?: string;
  search?: string;
  page?: number;
}

export function listLevels(filters: LevelListFilters = {}): Promise<Page<StockLevel>> {
  const params = new URLSearchParams();
  if (filters.branch) {
    params.set('branch', filters.branch);
  }
  if (filters.search) {
    params.set('search', filters.search);
  }
  if (filters.page) {
    params.set('page', String(filters.page));
  }
  params.set('limit', '50');
  return authedRequestPage<StockLevel>(`/v1/inventory/levels?${params}`);
}

/** Post opening stock — one immutable ledger movement (OPENING type). */
export function postOpeningStock(payload: OpeningStockPayload): Promise<StockMovement> {
  return authedRequest<StockMovement>('/v1/inventory/opening', {
    method: 'POST',
    body: payload,
  });
}
