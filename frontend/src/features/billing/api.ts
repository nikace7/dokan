/**
 * Billing endpoints (catalog lookup, customers, sales).
 *
 * Shapes follow `apps/catalog/selectors.py` (lookup), `apps/customers/
 * serializers.py`, and `apps/sales/serializers.py`. Regenerate the typed
 * client (`npm run api:gen`) once the schema endpoint is published and
 * drop these local types.
 */

import { ApiError, isNetworkError } from '@/lib/api/client';
import type { RequestOptions } from '@/lib/api/client';
import { authedRequest } from '@/lib/api/authed';
import { cacheVariant, lookupCachedVariant } from '@/lib/offline/catalogCache';
import type { Paisa } from '@/lib/money';

/** `GET /catalog/variants/lookup` — the POS hot path (plain dict from the selector). */
export interface VariantLookup {
  id: string;
  sku: string;
  barcode: string;
  size: string;
  color: string;
  color_hex: string;
  /** Money crosses the API as a string, e.g. "1500.00". */
  mrp: string;
  is_active: boolean;
  item__name: string;
  item__name_np: string;
  item__code: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  credit_limit: string | null;
  is_active: boolean;
}

export type PaymentMethod =
  'CASH' | 'ESEWA' | 'KHALTI' | 'FONEPAY' | 'CARD' | 'BANK' | 'CREDIT' | 'POINTS';

export interface PaymentPayload {
  method: PaymentMethod;
  /** Rupees as a decimal string. */
  amount: string;
}

export interface SaleLinePayload {
  variant: string;
  qty: string;
  discount: string;
}

export interface CreateSalePayload {
  branch: string;
  rate_type: string;
  customer?: string;
  lines: SaleLinePayload[];
  payments: PaymentPayload[];
  is_vat_bill: boolean;
}

export interface SalesInvoiceItem {
  id: string;
  variant: string;
  variant_sku: string;
  item_name: string;
  item_name_np: string | null;
  qty: string;
  unit_price: string;
  discount: string;
  line_total: string;
  returned_qty: string;
}

/** `SalesInvoiceDetailSerializer` (fields the billing screen uses). */
export interface SalesInvoice {
  id: string;
  tenant_name: string;
  tenant_name_np: string | null;
  legal_name: string | null;
  pan_vat_no: string | null;
  vat_registered: boolean;
  branch: string;
  branch_code: string;
  invoice_prefix: string;
  branch_name: string;
  branch_name_np: string | null;
  branch_address: string | null;
  branch_phone: string | null;
  invoice_no: number | null;
  doc_type: string;
  status: 'DRAFT' | 'HELD' | 'COMPLETED' | 'CANCELLED';
  customer: string | null;
  customer_name: string | null;
  rate_type_code: string;
  subtotal: string;
  discount_amount: string;
  taxable_amount: string;
  vat_amount: string;
  round_off: string;
  total: string;
  paid_amount: string;
  due_amount: string;
  is_vat_bill: boolean;
  print_count: number;
  tenders: Array<{ method: PaymentMethod; amount: string }>;
  datetime_ad: string;
  business_date_ad: string;
  business_date_bs: string;
  fiscal_year_bs: string;
  items: SalesInvoiceItem[];
}

export interface PlanUsageWarning {
  code: 'PLAN_USAGE_WARNING_80' | 'PLAN_USAGE_WARNING_100';
  usage: number;
  limit: number;
}

export interface SaleCompletion {
  invoice: SalesInvoice;
  planWarning: PlanUsageWarning | null;
}

async function completeWithUsageWarning(
  path: string,
  options: RequestOptions,
): Promise<SaleCompletion> {
  let planWarning: PlanUsageWarning | null = null;
  const invoice = await authedRequest<SalesInvoice>(path, {
    ...options,
    onResponse: (response) => {
      const code = response.headers.get('X-Plan-Usage-Warning');
      const usage = Number(response.headers.get('X-Plan-Usage'));
      const limit = Number(response.headers.get('X-Plan-Limit'));
      planWarning =
        (code === 'PLAN_USAGE_WARNING_80' || code === 'PLAN_USAGE_WARNING_100') &&
        Number.isFinite(usage) &&
        Number.isFinite(limit) &&
        limit > 0
          ? { code, usage, limit }
          : null;
    },
  });
  return { invoice, planWarning };
}

/**
 * Look up a variant by scanned/typed code. Scanners emit barcodes, but the
 * counter also types SKUs — try barcode first and fall back to SKU on a 404.
 *
 * Offline: a network failure falls back to the Dexie lookup cache (variants
 * previously fetched while online); every successful online lookup refreshes
 * that cache. A 404 stays a 404 — the server answered.
 */
export async function lookupVariant(code: string): Promise<VariantLookup> {
  try {
    const variant = await lookupVariantOnline(code);
    void cacheVariant(variant).catch(() => {
      // Cache writes are best-effort; a full/blocked IndexedDB must never
      // break the hot path.
    });
    return variant;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = await lookupCachedVariant(code);
      if (cached) {
        return cached;
      }
    }
    throw err;
  }
}

async function lookupVariantOnline(code: string): Promise<VariantLookup> {
  const params = new URLSearchParams({ barcode: code });
  try {
    return await authedRequest<VariantLookup>(`/v1/catalog/variants/lookup?${params}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return authedRequest<VariantLookup>(
        `/v1/catalog/variants/lookup?${new URLSearchParams({ sku: code })}`,
      );
    }
    throw err;
  }
}

/** Customer search for the udharo picker (first page is plenty at a counter). */
export function searchCustomers(search: string): Promise<Customer[]> {
  const params = new URLSearchParams({ search, limit: '10' });
  return authedRequest<Customer[]>(`/v1/customers?${params}`);
}

/** Integer paisa → API decimal string ("1500.00"). */
export function paisaToApiString(paisa: Paisa): string {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  return `${sign}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
}

export function createSale(payload: CreateSalePayload, idempotencyKey: string) {
  return completeWithUsageWarning('/v1/sales', {
    method: 'POST',
    body: payload,
    idempotencyKey,
  });
}

/** Park a bill — same body as a sale minus payments (HELD takes no stock). */
export function holdSale(
  payload: Omit<CreateSalePayload, 'payments' | 'is_vat_bill'>,
  idempotencyKey: string,
) {
  return authedRequest<SalesInvoice>('/v1/sales/hold', {
    method: 'POST',
    body: payload,
    idempotencyKey,
  });
}

/** Parked bills awaiting resume. The summary serializer omits `items`. */
export function listHeldBills(): Promise<Array<Omit<SalesInvoice, 'items'>>> {
  return authedRequest('/v1/sales/held');
}

export function getSale(id: string): Promise<SalesInvoice> {
  return authedRequest<SalesInvoice>(`/v1/sales/${id}`);
}

export function recordReceiptPrint(id: string): Promise<{ id: string; print_count: number }> {
  return authedRequest(`/v1/sales/${id}/print`, { method: 'POST', body: {} });
}

/** Tender a parked bill — turns HELD into COMPLETED. */
export function completeSale(id: string, payments: PaymentPayload[], idempotencyKey: string) {
  return completeWithUsageWarning(`/v1/sales/${id}/complete`, {
    method: 'POST',
    body: { payments },
    idempotencyKey,
  });
}

/** Branch/rate-type selected in the authenticated workspace shell. */
export function currentSaleContext(
  branchId: string,
  rateTypeId: string,
): { branch: string; rate_type: string } {
  return { branch: branchId, rate_type: rateTypeId };
}
