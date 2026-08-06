import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/useAuth';
import { fetchDashboard } from '@/features/dashboard/api';
import type { DashboardBill } from '@/features/dashboard/api';
import { SalesTrendChart } from '@/features/dashboard/SalesTrendChart';
import { formatNpr } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';
import { billingPath } from '@/lib/plans';

const money = (value: string) => formatNpr(value).replace(/\.00$/, '');

/**
 * Owner-first dashboard. Tiles render only when the server includes them —
 * the backend already filters by permission/plan, so a missing section is
 * simply not shown (never rendered as empty or "hidden" data, invariant 10).
 */
export function DashboardPage() {
  const { t } = useTranslation();
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
    return <DashboardSkeleton />;
  }

  if (dashboard.isError || !data) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {dashboard.error instanceof Error
            ? dashboard.error.message
            : t('dashboard.loadError')}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{data.shop_name}</h1>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.welcome', { name: user?.full_name })}
          </p>
        </div>
        <Badge variant="secondary" className="text-sm font-medium">
          BS {data.business_date_bs}
        </Badge>
      </header>

      <section
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label={t('dashboard.todaySummary')}
      >
        {data.sales ? (
          <SummaryTile
            title={t('dashboard.todaySales')}
            value={money(data.sales.today_total)}
            detail={t('dashboard.billsCount', { count: data.sales.bill_count })}
          />
        ) : null}
        {data.profit ? (
          <SummaryTile
            title={t('dashboard.todayProfit')}
            value={money(data.profit.today_net_profit)}
            detail={t('dashboard.costAuthorizedOnly')}
          />
        ) : null}
        {data.dues ? (
          <SummaryTile
            title={t('dashboard.receivables')}
            value={money(data.dues.total_receivable)}
            detail={t('dashboard.customersCount', { count: data.dues.customer_count })}
          />
        ) : null}
        {data.low_stock ? (
          <SummaryTile
            title={t('dashboard.lowStock')}
            value={t('dashboard.itemsCount', { count: data.low_stock.count })}
            detail={t('dashboard.atOrBelowReorder')}
          />
        ) : null}
      </section>

      <nav className="flex flex-wrap gap-2" aria-label={t('dashboard.quickActions')}>
        {hasPermission(user, 'sale.create') ? (
          <Button asChild size="lg">
            <Link to={billingPath(user)}>+ {t('dashboard.newBill')}</Link>
          </Button>
        ) : null}
        {hasPermission(user, 'stock.adjust') ? (
          <Button asChild variant="outline" size="lg">
            <Link to="/stock">{t('nav.stock')}</Link>
          </Button>
        ) : null}
        {canViewReports ? (
          <Button asChild variant="outline" size="lg">
            <Link to="/reports">{t('nav.reports')}</Link>
          </Button>
        ) : null}
        {hasPermission(user, 'report.ledger') ? (
          <Button asChild variant="outline" size="lg">
            <Link to="/customers">{t('nav.customers')}</Link>
          </Button>
        ) : null}
      </nav>

      {data.sales ? <SalesTrendChart rows={data.sales.last_30_days} /> : null}

      {data.recent_bills ? (
        <RecentBills
          bills={data.recent_bills}
          canViewSalesReport={hasPermission(user, 'report.sales')}
        />
      ) : null}
    </main>
  );
}

function DashboardSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-6 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-40 w-full" />
    </main>
  );
}

function SummaryTile({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card>
      <h2 className="text-xs font-medium text-muted-foreground sm:text-sm">{title}</h2>
      <p className="mt-1 text-lg font-semibold tracking-tight text-foreground sm:text-2xl">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
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
  const { t } = useTranslation();
  return (
    <Card
      title={t('dashboard.recentBills')}
      actions={
        canViewSalesReport ? (
          <Link to="/reports/sales" className="text-sm font-medium text-primary hover:underline">
            {t('dashboard.viewSales')}
          </Link>
        ) : null
      }
    >
      {bills.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('dashboard.noBills')}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {bills.map((bill) => (
            <li
              key={bill.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm"
            >
              <div className="min-w-0">
                <p className="font-mono font-medium">{bill.invoice_no}</p>
                <p className="truncate text-muted-foreground">
                  {bill.customer_name ?? t('billing.walkIn')}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium">{money(bill.total)}</p>
                <p className="text-xs text-muted-foreground">
                  {bill.tender_methods.join(' + ') || t('dashboard.credit')} ·{' '}
                  <time dateTime={bill.created_at}>
                    {new Date(bill.created_at).toLocaleString()}
                  </time>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
