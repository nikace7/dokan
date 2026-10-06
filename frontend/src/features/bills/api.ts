import { authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';
import type { SalesInvoice } from '@/features/billing/api';

/** `GET /sales` row — the detail payload minus `items`. */
export type BillSummary = Omit<SalesInvoice, 'items'>;

export type BillStatus = 'COMPLETED' | 'HELD' | 'CANCELLED';
export type BillDocType = 'SALE' | 'RETURN' | 'EXCHANGE_OUT';

export interface BillFilters {
  page: number;
  status: BillStatus | '';
  docType: BillDocType | '';
  /** A bill-number search looks across every date, so the range is ignored. */
  invoiceNo: number | null;
  dateFromBs: string;
  dateToBs: string;
}

export const BILLS_PAGE_SIZE = 25;

export function listBills(filters: BillFilters): Promise<Page<BillSummary>> {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: String(BILLS_PAGE_SIZE),
  });
  if (filters.status) params.set('status', filters.status);
  if (filters.docType) params.set('doc_type', filters.docType);
  if (filters.invoiceNo != null) {
    params.set('invoice_no', String(filters.invoiceNo));
  } else {
    params.set('date_from_bs', filters.dateFromBs);
    params.set('date_to_bs', filters.dateToBs);
  }
  return authedRequestPage<BillSummary>(`/v1/sales?${params.toString()}`);
}
