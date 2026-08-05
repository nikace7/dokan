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
  created_by_name?: string | null;
  created_at: string;
}

export interface MovementListFilters {
  branch?: string;
  variant?: string;
  type?: string;
  page?: number;
}

export interface AdjustmentPayload {
  branch: string;
  variant: string;
  qty_delta: string;
  reason: string;
}

export interface WriteOffPayload {
  branch: string;
  variant: string;
  qty: string;
  reason: string;
}

export interface StockTransferItem {
  id: string;
  variant: string;
  variant_sku: string;
  item_name: string;
  qty_sent: string;
  qty_received: string | null;
  unit_cost?: string | null;
}

export interface StockTransfer {
  id: string;
  from_branch: string;
  from_branch_code: string;
  to_branch: string;
  to_branch_code: string;
  status: 'DRAFT' | 'SENT' | 'RECEIVED' | 'CANCELLED';
  sent_at: string | null;
  received_at: string | null;
  note: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  items: StockTransferItem[];
}

export interface TransferLinePayload {
  variant: string;
  qty: string;
}

export interface StockCountItem {
  id: string;
  variant: string;
  variant_sku: string;
  item_name: string;
  system_qty: string;
  counted_qty: string | null;
  variance: string | null;
  note: string | null;
}

export interface StockCount {
  id: string;
  branch: string;
  branch_code: string;
  status: 'OPEN' | 'FINALIZED' | 'CANCELLED';
  started_at: string;
  finalized_at: string | null;
  created_by: string;
  created_by_name: string | null;
  items: StockCountItem[];
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

/** Read the immutable movement ledger, newest first. */
export function listMovements(filters: MovementListFilters = {}): Promise<Page<StockMovement>> {
  const params = new URLSearchParams();
  if (filters.branch) params.set('branch', filters.branch);
  if (filters.variant) params.set('variant', filters.variant);
  if (filters.type) params.set('type', filters.type);
  if (filters.page) params.set('page', String(filters.page));
  params.set('limit', '50');
  return authedRequestPage<StockMovement>(`/v1/inventory/movements?${params}`);
}

/** Post opening stock — one immutable ledger movement (OPENING type). */
export function postOpeningStock(payload: OpeningStockPayload): Promise<StockMovement> {
  return authedRequest<StockMovement>('/v1/inventory/opening', {
    method: 'POST',
    body: payload,
  });
}

export function postAdjustment(payload: AdjustmentPayload): Promise<StockMovement> {
  return authedRequest<StockMovement>('/v1/inventory/adjustments', {
    method: 'POST',
    body: payload,
  });
}

export function postWriteOff(payload: WriteOffPayload): Promise<StockMovement> {
  return authedRequest<StockMovement>('/v1/inventory/write-offs', {
    method: 'POST',
    body: payload,
  });
}

export function listTransfers(): Promise<Page<StockTransfer>> {
  return authedRequestPage<StockTransfer>('/v1/inventory/transfers?limit=50');
}

export function createTransfer(payload: {
  from_branch: string;
  to_branch: string;
  note?: string;
  lines: TransferLinePayload[];
}): Promise<StockTransfer> {
  return authedRequest<StockTransfer>('/v1/inventory/transfers', { method: 'POST', body: payload });
}

function transferAction(id: string, action: string, body?: unknown): Promise<StockTransfer> {
  return authedRequest<StockTransfer>(`/v1/inventory/transfers/${id}/${action}`, {
    method: 'POST',
    ...(body === undefined ? {} : { body }),
  });
}

export const sendTransfer = (id: string) => transferAction(id, 'send');
export const completeTransfer = (id: string) => transferAction(id, 'complete');
export const cancelTransfer = (id: string) =>
  authedRequest<{ id: string; status: 'CANCELLED' }>(`/v1/inventory/transfers/${id}/cancel`, {
    method: 'POST',
  });
export const receiveTransfer = (id: string, lines: TransferLinePayload[]) =>
  transferAction(id, 'receive', { lines });

export function listInTransit(): Promise<
  { variant_id: string; sku: string; item_name: string; qty_in_transit: string }[]
> {
  return authedRequest('/v1/inventory/transfers/in-transit');
}

export function listCounts(branch?: string): Promise<Page<StockCount>> {
  const params = new URLSearchParams({ limit: '50' });
  if (branch) params.set('branch', branch);
  return authedRequestPage<StockCount>(`/v1/inventory/counts?${params}`);
}

export function startCount(branch: string): Promise<StockCount> {
  return authedRequest<StockCount>('/v1/inventory/counts', {
    method: 'POST',
    body: { branch },
  });
}

export function recordCounts(
  id: string,
  counts: { variant: string; counted_qty: string; note?: string }[],
): Promise<StockCount> {
  return authedRequest<StockCount>(`/v1/inventory/counts/${id}/record`, {
    method: 'POST',
    body: { counts },
  });
}

export const finalizeCount = (id: string) =>
  authedRequest<StockCount>(`/v1/inventory/counts/${id}/finalize`, { method: 'POST' });
export const cancelCount = (id: string) =>
  authedRequest<{ id: string; status: 'CANCELLED' }>(`/v1/inventory/counts/${id}/cancel`, {
    method: 'POST',
  });
