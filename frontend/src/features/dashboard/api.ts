import { authedRequest } from '@/lib/api/authed';

export interface DashboardSalesDay {
  business_date_bs: string;
  net_total: string;
}

export interface DashboardBill {
  id: string;
  invoice_no: string;
  customer_name: string | null;
  total: string;
  tender_methods: string[];
  created_at: string;
}

export interface DashboardSummary {
  shop_name: string;
  business_date_bs: string;
  sales?: {
    /** Aggregates are present only with report.sales; staff see bill_count. */
    today_total?: string;
    bill_count: number;
    /** Month-to-date window anchor (current BS month's 1st) and total. */
    month_start_bs?: string;
    month_to_date_total?: string;
    last_30_days?: DashboardSalesDay[];
  };
  profit?: { today_net_profit: string };
  dues?: { total_receivable: string; customer_count: number };
  low_stock?: { count: number };
  recent_bills?: DashboardBill[];
}

export function fetchDashboard(): Promise<DashboardSummary> {
  return authedRequest<DashboardSummary>('/v1/dashboard');
}

export interface TenderCollection {
  method: string;
  /** 2-decimal money string, e.g. "45200.00". */
  amount: string;
  count: number;
}

/** `GET /reports/collections-by-tender` — perm `report.sales`. CREDIT is
 *  never included server-side (it is not a collection). */
export interface CollectionsByTender {
  date_from_bs: string;
  date_to_bs: string;
  methods: TenderCollection[];
  total: string;
}

/**
 * Tender breakdown for the dashboard donut. All params optional server-side;
 * pass the current BS month and selected branch for the home default.
 */
export function fetchCollectionsByTender(params: {
  branch?: string | null;
  dateFromBs: string;
  dateToBs: string;
}): Promise<CollectionsByTender> {
  const search = new URLSearchParams({
    date_from_bs: params.dateFromBs,
    date_to_bs: params.dateToBs,
  });
  if (params.branch) {
    search.set('branch', params.branch);
  }
  return authedRequest<CollectionsByTender>(`/v1/reports/collections-by-tender?${search}`);
}
