import { lookupVariant } from '@/features/billing/api';
import type { SalesInvoice, VariantLookup } from '@/features/billing/api';
import { authedRequest } from '@/lib/api/authed';
import type { ReturnableLine, SaleSummary } from '@/features/returns/api';
import { getReturnableLines, listSales } from '@/features/returns/api';

export type ExchangePaymentMethod =
  'CASH' | 'ESEWA' | 'KHALTI' | 'FONEPAY' | 'CARD' | 'BANK' | 'CREDIT';

export interface ExchangePayload {
  original_invoice: string;
  returned_lines: Array<{ variant: string; qty: string }>;
  new_lines: Array<{ variant: string; qty: string; discount: string }>;
  payments: Array<{ method: ExchangePaymentMethod; amount: string }>;
  reason: string;
}

export interface ExchangeResult {
  return_invoice: SalesInvoice;
  sale_invoice: SalesInvoice;
  exchange_group_id: string;
  refund_amount: string;
}

export function createExchange(payload: ExchangePayload): Promise<ExchangeResult> {
  return authedRequest<ExchangeResult>('/v1/sales/exchanges', { method: 'POST', body: payload });
}

export { getReturnableLines, listSales, lookupVariant };
export type { ReturnableLine, SaleSummary, VariantLookup };
