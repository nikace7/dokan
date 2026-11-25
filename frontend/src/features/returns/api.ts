import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';
import type { SalesInvoice } from '@/features/billing/api';

export interface SaleSummary {
  id: string;
  branch_code: string;
  invoice_prefix: string;
  invoice_no: number | null;
  doc_type: 'SALE' | 'RETURN' | 'EXCHANGE_OUT';
  customer_name: string | null;
  total: string;
  business_date_bs: string;
  status: 'HELD' | 'COMPLETED' | 'CANCELLED';
}

export interface ReturnableLine {
  variant: string;
  sku: string;
  item_name: string;
  qty: string;
  returned_qty: string;
  remaining: string;
}

export type RefundMethod =
  'CASH' | 'ESEWA' | 'KHALTI' | 'FONEPAY' | 'CARD' | 'BANK' | 'CREDIT_NOTE';

export interface ReturnPayload {
  original_invoice: string;
  lines: Array<{ variant: string; qty: string }>;
  reason: string;
  refunds?: Array<{ method: RefundMethod; amount: string }>;
}

export interface ReturnQuoteRequest {
  returned_lines: Array<{ variant: string; qty: string }>;
  new_lines?: Array<{ variant: string; qty: string; discount: string }>;
}

/** What a return or exchange would come to. The server works it out; nothing is saved. */
export interface ReturnQuote {
  return_total: string;
  new_total: string;
  to_collect: string;
  to_refund: string;
  max_credit_note: string;
}

export function quoteReturn(invoiceId: string, body: ReturnQuoteRequest): Promise<ReturnQuote> {
  return authedRequest<ReturnQuote>(`/v1/sales/${invoiceId}/return-quote`, {
    method: 'POST',
    body,
  });
}

export function listSales(page = 1, invoiceNo?: number): Promise<Page<SaleSummary>> {
  const invoice = invoiceNo != null ? `&invoice_no=${invoiceNo}` : '';
  return authedRequestPage<SaleSummary>(
    `/v1/sales?status=COMPLETED&limit=20&page=${page}${invoice}`,
  );
}

export function getReturnableLines(invoiceId: string): Promise<ReturnableLine[]> {
  return authedRequest<ReturnableLine[]>(`/v1/sales/${invoiceId}/returnable`);
}

export function createReturn(payload: ReturnPayload): Promise<SalesInvoice> {
  return authedRequest<SalesInvoice>('/v1/sales/returns', { method: 'POST', body: payload });
}
