/**
 * Reports endpoints — the owner's read models.
 *
 * Reports are BS-native: date params are BS strings 'YYYY-MM-DD' and the
 * server compares them lexicographically against the denormalized columns
 * (no conversion server-side; none here either). Shapes follow
 * `apps/reports/selectors/`. Daily/monthly/dues/profit/VAT responses are
 * unpaginated; item-sales and the stock reports paginate in the envelope
 * meta (fetched via `authedRequestPage`).
 *
 * Cost visibility: stock-summary includes `avg_cost`/`cost_valuation` only
 * for users with `pricing.view_cost`; profit requires it too and returns
 * 403 otherwise — the UI branches on presence/403, never on guessed
 * permissions (invariant 10).
 */

import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';
import { adToBs, fiscalYearBs, toBsString } from '@/lib/bs';

export interface BsRange {
  dateFromBs: string;
  dateToBs: string;
}

export interface DailySalesRow {
  business_date_bs: string;
  bill_count: number;
  subtotal: string;
  discount: string;
  vat: string;
  total: string;
  paid: string;
  due: string;
  returns_count: number;
  returns_total: string;
  net_total: string;
}

export interface MonthlySalesRow {
  bs_month: string;
  bill_count: number;
  total: string;
  discount: string;
  vat: string;
  returns_total: string;
  net_total: string;
}

export interface ItemSalesRow {
  variant_id: string;
  sku: string;
  item_name: string;
  size: string;
  color: string;
  qty: string;
  amount: string;
}

export interface StockSummaryRow {
  variant_id: string;
  sku: string;
  item_name: string;
  branch_id: string;
  branch_code: string;
  qty_on_hand: string;
  mrp: string | null;
  mrp_valuation: string | null;
  /** Present only with `pricing.view_cost` — never assume them. */
  avg_cost?: string;
  cost_valuation?: string;
}

export interface LowStockRow {
  variant_id: string;
  sku: string;
  item_name: string;
  branch_id: string;
  qty_on_hand: string;
  reorder_level: string;
}

export interface DeadStockRow {
  variant_id: string;
  sku: string;
  item_name: string;
  branch_id: string;
  qty_on_hand: string;
}

export interface ProfitRow {
  bs_month: string;
  sales_total: string;
  returns_total: string;
  revenue: string;
  cogs: string;
  gross_profit: string;
}

export interface ProfitReport {
  date_from_bs: string;
  date_to_bs: string;
  rows: ProfitRow[];
  totals: { revenue: string; cogs: string; gross_profit: string };
}

export type AgingBucketLabel = '0-30' | '31-60' | '61-90' | '90+';

export const AGING_BUCKETS: AgingBucketLabel[] = ['0-30', '31-60', '61-90', '90+'];

export interface ReceivableRow {
  customer_id: string;
  customer_name: string;
  buckets: Record<AgingBucketLabel, string>;
  total_outstanding: string;
  unallocated: string;
}

export interface PayableRow {
  supplier_id: string;
  supplier_name: string;
  payable: string;
}

export interface DuesReport {
  receivables: ReceivableRow[];
  payables: PayableRow[];
}

export interface SalesVatRow {
  invoice_no: string;
  doc_type: string;
  business_date_bs: string;
  customer_name: string | null;
  /** Not modelled yet server-side — always null for now. */
  customer_pan: string | null;
  taxable_amount: string;
  vat_amount: string;
  total: string;
}

export interface PurchaseVatRow {
  invoice_no: string;
  bill_date_bs: string;
  supplier_name: string;
  supplier_pan: string | null;
  taxable_amount: string;
  vat_amount: string;
  total: string;
}

export interface VatRegister<TRow> {
  date_from_bs: string;
  date_to_bs: string;
  rows: TRow[];
  totals: { taxable_amount: string; vat_amount: string; total: string };
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

function rangeParams(range: BsRange): Record<string, string> {
  return { date_from_bs: range.dateFromBs, date_to_bs: range.dateToBs };
}

export function fetchDailySales(range: BsRange): Promise<DailySalesRow[]> {
  return authedRequest<DailySalesRow[]>(`/v1/reports/daily-sales${qs(rangeParams(range))}`);
}

export function fetchMonthlySales(fiscalYear: string): Promise<MonthlySalesRow[]> {
  return authedRequest<MonthlySalesRow[]>(
    `/v1/reports/monthly-sales${qs({ fiscal_year_bs: fiscalYear })}`,
  );
}

export function fetchItemSales(range: BsRange): Promise<Page<ItemSalesRow>> {
  return authedRequestPage<ItemSalesRow>(
    `/v1/reports/item-sales${qs({ ...rangeParams(range), limit: 20 })}`,
  );
}

export function fetchStockSummary(page = 1): Promise<Page<StockSummaryRow>> {
  return authedRequestPage<StockSummaryRow>(`/v1/reports/stock-summary${qs({ page, limit: 50 })}`);
}

export function fetchLowStock(page = 1): Promise<Page<LowStockRow>> {
  return authedRequestPage<LowStockRow>(`/v1/reports/low-stock${qs({ page, limit: 50 })}`);
}

export function fetchDeadStock(days: number, page = 1): Promise<Page<DeadStockRow>> {
  return authedRequestPage<DeadStockRow>(
    `/v1/reports/dead-stock${qs({ days, page, limit: 50 })}`,
  );
}

export function fetchProfit(range: BsRange): Promise<ProfitReport> {
  return authedRequest<ProfitReport>(`/v1/reports/profit${qs(rangeParams(range))}`);
}

export function fetchDues(): Promise<DuesReport> {
  return authedRequest<DuesReport>('/v1/reports/dues');
}

export function fetchSalesVatRegister(range: BsRange): Promise<VatRegister<SalesVatRow>> {
  return authedRequest(`/v1/reports/vat-register/sales${qs(rangeParams(range))}`);
}

export function fetchPurchaseVatRegister(range: BsRange): Promise<VatRegister<PurchaseVatRow>> {
  return authedRequest(`/v1/reports/vat-register/purchase${qs(rangeParams(range))}`);
}

/** Today's AD date in Kathmandu as an ISO string (YYYY-MM-DD). */
function todayAdKathmandu(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

/** Default report range per design §5.3: the current BS month. */
export function currentBsMonthRange(): BsRange {
  const today = adToBs(todayAdKathmandu());
  const monthStart = toBsString({ ...today, day: 1 });
  return { dateFromBs: monthStart, dateToBs: toBsString(today) };
}

/** Current Nepali fiscal year (`2082-83`) for the monthly sales default. */
export function currentFiscalYearBs(): string {
  return fiscalYearBs(adToBs(todayAdKathmandu()));
}
