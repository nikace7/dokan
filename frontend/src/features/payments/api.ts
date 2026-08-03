import { paisaToApiString, searchCustomers } from '@/features/billing/api';
import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';
import { demoConfig } from '@/lib/config';
import { addPaisa, toPaisa } from '@/lib/money';

export type PaymentDirection = 'RECEIPT' | 'PAYMENT';
export type ReceiptMethod = 'CASH' | 'ESEWA' | 'KHALTI' | 'FONEPAY' | 'CARD' | 'BANK';

export interface PaymentAllocation {
  id: string;
  sales_invoice: string | null;
  purchase_invoice: string | null;
  amount: string;
}

export interface PaymentAllocationInput {
  invoice: string;
  amount: string;
}

export interface LedgerRow {
  date: string;
  kind: string;
  ref: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface AllocationInvoice {
  id: string;
  invoice_no: string | number | null;
  due_amount: string;
  outstanding: string;
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
  allocations?: PaymentAllocationInput[];
}

export interface SupplierPaymentPayload {
  branch: string;
  supplier: string;
  amount: string;
  method: ReceiptMethod;
  ref_no?: string;
  note?: string;
  allocations?: PaymentAllocationInput[];
}

export interface PaymentListFilters {
  direction?: PaymentDirection;
  method?: ReceiptMethod;
  customer?: string;
  supplier?: string;
  page?: number;
  limit?: number;
}

export interface CashSession {
  id: string;
  branch: string;
  branch_code: string;
  opened_by: string;
  opened_by_name: string | null;
  opened_at: string;
  opening_float: string;
  closed_by: string | null;
  closed_at: string | null;
  counted_cash: string | null;
  expected_cash: string | null;
  variance: string | null;
  note: string | null;
}

export function listPayments(filters: PaymentListFilters = {}): Promise<Page<Payment>> {
  const params = new URLSearchParams({
    limit: String(filters.limit ?? 20),
    page: String(filters.page ?? 1),
  });
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.method) params.set('method', filters.method);
  if (filters.customer) params.set('customer', filters.customer);
  if (filters.supplier) params.set('supplier', filters.supplier);
  return authedRequestPage<Payment>(`/v1/payments?${params}`);
}

export function recordReceipt(payload: ReceiptPayload): Promise<Payment> {
  return authedRequest<Payment>('/v1/payments/receipts', { method: 'POST', body: payload });
}

export function recordSupplierPayment(payload: SupplierPaymentPayload): Promise<Payment> {
  return authedRequest<Payment>('/v1/payments/supplier-payments', {
    method: 'POST',
    body: payload,
  });
}

export function getCurrentCashSession(
  branch = demoConfig.branchId,
): Promise<{ session: CashSession | null }> {
  return authedRequest<{ session: CashSession | null }>(
    `/v1/cash-sessions/current?branch=${encodeURIComponent(branch)}`,
  );
}

export function openCashSession(openingFloat: string, note: string): Promise<CashSession> {
  return authedRequest<CashSession>('/v1/cash-sessions/open', {
    method: 'POST',
    body: { branch: demoConfig.branchId, opening_float: openingFloat, note },
  });
}

export function closeCashSession(id: string, countedCash: string): Promise<CashSession> {
  return authedRequest<CashSession>(`/v1/cash-sessions/${id}/close`, {
    method: 'POST',
    body: { counted_cash: countedCash },
  });
}

export function getCustomerLedger(customerId: string): Promise<LedgerRow[]> {
  return authedRequest<LedgerRow[]>(`/v1/customers/${customerId}/ledger`);
}

export function getSupplierLedger(supplierId: string): Promise<LedgerRow[]> {
  return authedRequest<LedgerRow[]>(`/v1/purchasing/suppliers/${supplierId}/ledger`);
}

async function allPayments(filters: Omit<PaymentListFilters, 'page'>): Promise<Payment[]> {
  const first = await listPayments({ ...filters, page: 1, limit: 200 });
  const rows = [...first.data];
  for (let page = 2; page <= (first.meta?.total_pages ?? 1); page += 1) {
    rows.push(...(await listPayments({ ...filters, page, limit: 200 })).data);
  }
  return rows;
}

function withOutstanding(
  invoices: Array<Omit<AllocationInvoice, 'outstanding'>>,
  payments: Payment[],
  allocationField: 'sales_invoice' | 'purchase_invoice',
): AllocationInvoice[] {
  const allocated = new Map<string, number>();
  for (const payment of payments) {
    for (const allocation of payment.allocations) {
      const invoiceId = allocation[allocationField];
      if (invoiceId) {
        allocated.set(
          invoiceId,
          addPaisa(allocated.get(invoiceId) ?? 0, toPaisa(allocation.amount)),
        );
      }
    }
  }
  return invoices
    .map((invoice) => {
      const outstanding = Math.max(
        toPaisa(invoice.due_amount) - (allocated.get(invoice.id) ?? 0),
        0,
      );
      return { ...invoice, outstanding: paisaToApiString(outstanding) };
    })
    .filter((invoice) => toPaisa(invoice.outstanding) > 0);
}

export async function listCustomerAllocationInvoices(
  customerId: string,
): Promise<AllocationInvoice[]> {
  const [invoices, payments] = await Promise.all([
    allSalesForCustomer(customerId),
    allPayments({ direction: 'RECEIPT', customer: customerId }),
  ]);
  return withOutstanding(invoices, payments, 'sales_invoice');
}

export async function listSupplierAllocationInvoices(
  supplierId: string,
): Promise<AllocationInvoice[]> {
  const [invoices, payments] = await Promise.all([
    allPurchasesForSupplier(supplierId),
    allPayments({ direction: 'PAYMENT', supplier: supplierId }),
  ]);
  return withOutstanding(invoices, payments, 'purchase_invoice');
}

async function allSalesForCustomer(
  customerId: string,
): Promise<Array<Omit<AllocationInvoice, 'outstanding'>>> {
  const first = await authedRequestPage<Omit<AllocationInvoice, 'outstanding'>>(
    `/v1/sales?status=COMPLETED&customer=${encodeURIComponent(customerId)}&limit=200&page=1`,
  );
  const rows = [...first.data];
  for (let page = 2; page <= (first.meta?.total_pages ?? 1); page += 1) {
    rows.push(
      ...(
        await authedRequestPage<Omit<AllocationInvoice, 'outstanding'>>(
          `/v1/sales?status=COMPLETED&customer=${encodeURIComponent(customerId)}&limit=200&page=${page}`,
        )
      ).data,
    );
  }
  return rows.filter((invoice) => toPaisa(invoice.due_amount) > 0);
}

async function allPurchasesForSupplier(
  supplierId: string,
): Promise<Array<Omit<AllocationInvoice, 'outstanding'>>> {
  const first = await authedRequestPage<Omit<AllocationInvoice, 'outstanding'>>(
    `/v1/purchasing/invoices?status=CONFIRMED&supplier=${encodeURIComponent(supplierId)}&limit=200&page=1`,
  );
  const rows = [...first.data];
  for (let page = 2; page <= (first.meta?.total_pages ?? 1); page += 1) {
    rows.push(
      ...(
        await authedRequestPage<Omit<AllocationInvoice, 'outstanding'>>(
          `/v1/purchasing/invoices?status=CONFIRMED&supplier=${encodeURIComponent(supplierId)}&limit=200&page=${page}`,
        )
      ).data,
    );
  }
  return rows.filter((invoice) => toPaisa(invoice.due_amount) > 0);
}

export { demoConfig, searchCustomers };
