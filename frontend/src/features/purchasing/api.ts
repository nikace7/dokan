/**
 * Purchasing endpoints (suppliers + purchase invoices).
 *
 * Shapes follow `apps/purchasing/serializers.py`. A purchase invoice is
 * created as DRAFT (no stock moves); `confirm` posts the immutable stock
 * ledger entries and updates cost — irreversible server-side.
 */

import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  pan_no: string | null;
  address: string | null;
  opening_balance: string;
  credit_days: number | null;
  is_active: boolean;
}

export interface SupplierPayload {
  name: string;
  phone?: string | null;
  pan_no?: string | null;
  address?: string | null;
  credit_days?: number | null;
}

export interface PurchaseLinePayload {
  variant: string;
  qty: string;
  unit_cost: string;
  discount: string;
}

export interface PurchaseInvoicePayload {
  branch: string;
  supplier: string;
  /** ISO date (YYYY-MM-DD). */
  bill_date_ad: string;
  is_vat_bill: boolean;
  other_charges: string;
  paid_amount: string;
  note?: string;
  lines: PurchaseLinePayload[];
}

export interface PurchaseInvoiceItem {
  id: string;
  variant: string;
  variant_sku: string;
  item_name: string;
  qty: string;
  unit_cost: string;
  discount: string;
  line_total: string;
}

export type PurchaseInvoiceStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface PurchaseInvoice {
  id: string;
  branch: string;
  branch_code: string;
  supplier: string;
  supplier_name: string;
  invoice_no: string;
  supplier_bill_no: string | null;
  bill_date_ad: string;
  bill_date_bs: string;
  fiscal_year_bs: string;
  subtotal: string;
  discount: string;
  taxable_amount: string;
  vat_amount: string;
  other_charges: string;
  total: string;
  paid_amount: string;
  due_amount: string;
  status: PurchaseInvoiceStatus;
  is_vat_bill: boolean;
  note: string;
  created_at: string;
  items: PurchaseInvoiceItem[];
}

export function listSuppliers(search?: string): Promise<Page<Supplier>> {
  const params = new URLSearchParams({ limit: '200' });
  if (search) {
    params.set('search', search);
  }
  return authedRequestPage<Supplier>(`/v1/purchasing/suppliers?${params}`);
}

export function createSupplier(payload: SupplierPayload): Promise<Supplier> {
  return authedRequest<Supplier>('/v1/purchasing/suppliers', { method: 'POST', body: payload });
}

export function listInvoices(status?: string, page = 1): Promise<Page<PurchaseInvoice>> {
  const params = new URLSearchParams({ limit: '25', page: String(page) });
  if (status) {
    params.set('status', status);
  }
  return authedRequestPage<PurchaseInvoice>(`/v1/purchasing/invoices?${params}`);
}

export function getInvoice(id: string): Promise<PurchaseInvoice> {
  return authedRequest<PurchaseInvoice>(`/v1/purchasing/invoices/${id}`);
}

export function createInvoice(payload: PurchaseInvoicePayload): Promise<PurchaseInvoice> {
  return authedRequest<PurchaseInvoice>('/v1/purchasing/invoices', {
    method: 'POST',
    body: payload,
  });
}

/** DRAFT → CONFIRMED: posts stock + cost, irreversible. No request body. */
export function confirmInvoice(id: string): Promise<PurchaseInvoice> {
  return authedRequest<PurchaseInvoice>(`/v1/purchasing/invoices/${id}/confirm`, {
    method: 'POST',
  });
}
