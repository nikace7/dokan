import { searchCustomers } from '@/features/billing/api';
import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';
import { demoConfig } from '@/lib/config';

export type PaymentDirection = 'RECEIPT' | 'PAYMENT';
export type ReceiptMethod = 'CASH' | 'ESEWA' | 'KHALTI' | 'FONEPAY' | 'CARD' | 'BANK';

export interface PaymentAllocation {
  id: string;
  sales_invoice: string | null;
  purchase_invoice: string | null;
  amount: string;
}

export interface Payment {
  id: string;
  branch: string;
  branch_code: string;
  direction: PaymentDirection;
  party_type: 'CUSTOMER' | 'SUPPLIER';
  customer: string | null;
  customer_name: string | null;
  supplier: string | null;
  supplier_name: string | null;
  method: ReceiptMethod;
  amount: string;
  ref_no: string | null;
  note: string | null;
  business_date_ad: string;
  business_date_bs: string;
  fiscal_year_bs: string;
  created_by: string;
  created_at: string;
  allocations: PaymentAllocation[];
}

export interface ReceiptPayload {
  branch: string;
  customer: string;
  amount: string;
  method: ReceiptMethod;
  ref_no?: string;
  note?: string;
}

export interface PaymentListFilters {
  direction?: PaymentDirection;
  method?: ReceiptMethod;
  page?: number;
}

export function listPayments(filters: PaymentListFilters = {}): Promise<Page<Payment>> {
  const params = new URLSearchParams({ limit: '20', page: String(filters.page ?? 1) });
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.method) params.set('method', filters.method);
  return authedRequestPage<Payment>(`/v1/payments?${params}`);
}

export function recordReceipt(payload: ReceiptPayload): Promise<Payment> {
  return authedRequest<Payment>('/v1/payments/receipts', { method: 'POST', body: payload });
}

export { demoConfig, searchCustomers };
