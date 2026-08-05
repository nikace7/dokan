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
    today_total: string;
    bill_count: number;
    last_30_days: DashboardSalesDay[];
  };
  profit?: { today_net_profit: string };
  dues?: { total_receivable: string; customer_count: number };
  low_stock?: { count: number };
  recent_bills?: DashboardBill[];
}

export function fetchDashboard(): Promise<DashboardSummary> {
  return authedRequest<DashboardSummary>('/v1/dashboard');
}
