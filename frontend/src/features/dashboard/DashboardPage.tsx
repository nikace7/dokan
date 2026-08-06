import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/useAuth';
import { fetchDashboard } from '@/features/dashboard/api';
import type { DashboardBill, DashboardSalesDay } from '@/features/dashboard/api';
import { formatNpr, toPaisa } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';
import { billingPath } from '@/lib/plans';

const actionClass =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-3 font-semibold text-blue-800 shadow-sm hover:bg-blue-50';

const money = (value: string) => formatNpr(value).replace(/\.00$/, '');

export function DashboardPage() {
  const { user } = useAuth();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
    enabled: Boolean(user),
  });
  const data = dashboard.data;
  const canViewReports =
    user?.permissions.some((permission) => permission.startsWith('report.')) ?? false;

  if (dashboard.isPending) {
    return <main className="p-6 text-sm text-slate-500">Loading dashboard…</main>;
  }

  if (dashboard.isError || !data) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {dashboard.error instanceof Error
            ? dashboard.error.message
            : 'Could not load the dashboard.'}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-5 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{data.shop_name}</h1>
          <p className="text-sm text-slate-500">Welcome, {user?.full_name}</p>
        </div>
        <p className="font-medium text-slate-700">BS {data.business_date_bs}</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Today summary">
        {data.sales ? (
          <SummaryTile
            title="आजको बिक्री / Today sales"
            value={money(data.sales.today_total)}
            detail={`${data.sales.bill_count} bills`}
          />
        ) : null}
        {data.profit ? (
          <SummaryTile
            title="आजको नाफा / Today profit"
            value={money(data.profit.today_net_profit)}
            detail="Cost-authorized only"
          />
        ) : null}
        {data.dues ? (
          <SummaryTile
            title="बाँकी रकम / Receivables"
            value={money(data.dues.total_receivable)}
            detail={`${data.dues.customer_count} customers`}
          />
        ) : null}
        {data.low_stock ? (
          <SummaryTile
            title="कम स्टक / Low stock"
            value={`${data.low_stock.count} items`}
            detail="At or below reorder level"
          />
        ) : null}
      </section>

      {data.sales ? <SalesTrend rows={data.sales.last_30_days} /> : null}

      <nav className="flex flex-wrap gap-3" aria-label="Quick actions">
        {hasPermission(user, 'sale.create') ? (
          <Link
            to={billingPath(user)}
            className={`${actionClass} border-blue-700 bg-blue-700 text-white`}
          >
            + नयाँ बिल / New bill
          </Link>
        ) : null}
        {hasPermission(user, 'stock.adjust') ? (
          <Link to="/stock" className={actionClass}>
            Stock / स्टक
          </Link>
        ) : null}
        {canViewReports ? (
          <Link to="/reports" className={actionClass}>
            Reports / रिपोर्ट
          </Link>
        ) : null}
        {hasPermission(user, 'report.ledger') ? (
          <Link to="/customers" className={actionClass}>
            Customers / ग्राहक
          </Link>
        ) : null}
      </nav>

      {data.recent_bills ? (
        <RecentBills
          bills={data.recent_bills}
          canViewSalesReport={hasPermission(user, 'report.sales')}
        />
      ) : null}
    </main>
  );
}

function SummaryTile({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card>
      <h2 className="text-sm font-medium text-slate-600">{title}</h2>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </Card>
  );
}

function SalesTrend({ rows }: { rows: DashboardSalesDay[] }) {
  const values = rows.map((row) => toPaisa(row.net_total));
  const maximum = Math.max(...values, 1);
  return (
    <Card title="Last 30 days sales">
      {rows.length ? (
        <div className="flex h-32 items-end gap-1" role="img" aria-label="Last 30 days sales">
          {rows.map((row, index) => (
            <div
              key={row.business_date_bs}
              className="min-w-1 flex-1 rounded-t bg-blue-600"
              style={{ height: `${Math.max(5, (values[index] / maximum) * 100)}%` }}
              title={`${row.business_date_bs}: ${money(row.net_total)}`}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No completed sales in the last 30 days.</p>
      )}
    </Card>
  );
}

function RecentBills({
  bills,
  canViewSalesReport,
}: {
  bills: DashboardBill[];
  canViewSalesReport: boolean;
}) {
  return (
    <Card
      title="Recent bills"
      actions={
        canViewSalesReport ? (
          <Link to="/reports/sales" className="text-sm text-blue-700 underline">
            View sales
          </Link>
        ) : null
      }
    >
      {bills.length === 0 ? (
        <p className="text-sm text-slate-500">No completed bills yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {bills.map((bill) => (
            <li key={bill.id} className="grid gap-1 py-2 text-sm sm:grid-cols-5">
              <span className="font-mono font-medium">{bill.invoice_no}</span>
              <span>{bill.customer_name ?? 'Walk-in'}</span>
              <span className="font-medium">{money(bill.total)}</span>
              <span>{bill.tender_methods.join(' + ') || 'Credit'}</span>
              <time className="text-slate-500" dateTime={bill.created_at}>
                {new Date(bill.created_at).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
