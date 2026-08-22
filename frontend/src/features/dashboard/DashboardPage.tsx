import { useQuery } from '@tanstack/react-query';
import { Banknote, ChartBar, Package, PackageX, Plus, Receipt, Users, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChartCard } from '@/components/ui/ChartCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressDonut } from '@/components/ui/ProgressDonut';
import type { DonutTint } from '@/components/ui/ProgressDonut';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/StatTile';
import type { StatTileTint } from '@/components/ui/StatTile';
import { useAuth } from '@/features/auth/useAuth';
import { fetchCollectionsByTender, fetchDashboard } from '@/features/dashboard/api';
import type { DashboardBill } from '@/features/dashboard/api';
import { LowStockStrip } from '@/features/dashboard/LowStockStrip';
import { SalesTrendChart } from '@/features/dashboard/SalesTrendChart';
import { currentBsMonthRange } from '@/features/reports/api';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { formatNpr, toPaisa, useMoneyDisplay } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';
import { billingPath } from '@/lib/plans';

const money = (value: string) => formatNpr(value).replace(/\.00$/, '');

const DONUT_TINTS: DonutTint[] = ['green', 'blue', 'amber', 'violet', 'rose'];

/**
 * Owner home (design §7.2, v2): greeting header, stat tiles, trend + tender
 * donut, quick actions, recent bills. Tiles render only when the server
 * includes them — the backend already filters by permission/plan, so a
 * missing section is simply not shown (never rendered as empty or "hidden"
 * data, invariant 10). The tender donut additionally needs report.sales
 * (the collections endpoint enforces it server-side too).
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const workspace = useWorkspace();
  const navigate = useNavigate();
  useMoneyDisplay();

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
    enabled: Boolean(user),
  });

  const canViewSalesReport = hasPermission(user, 'report.sales');
  const canViewReports =
    user?.permissions.some((permission) => permission.startsWith('report.')) ?? false;

  const range = currentBsMonthRange();
  const collections = useQuery({
    queryKey: ['reports', 'collections-by-tender', workspace.branchId, range.dateFromBs],
    queryFn: () =>
      fetchCollectionsByTender({
        branch: workspace.branchId,
        dateFromBs: range.dateFromBs,
        dateToBs: range.dateToBs,
      }),
    enabled: Boolean(user) && canViewSalesReport,
  });

  if (dashboard.isPending) {
    return <DashboardSkeleton />;
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {dashboard.error instanceof Error ? dashboard.error.message : t('dashboard.loadError')}
        </p>
      </main>
    );
  }

  const data = dashboard.data;
  const branchName = workspace.branches.find((b) => b.id === workspace.branchId)?.name;

  const isEmptyShop =
    data.sales !== undefined &&
    data.sales.bill_count === 0 &&
    (data.recent_bills === undefined || data.recent_bills.length === 0);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {t('dashboard.greeting', { name: user?.full_name })}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data.shop_name}
            {branchName ? ` · ${branchName}` : ''} · BS {data.business_date_bs}
          </p>
        </div>
        <div className="flex gap-2">
          {canViewReports ? (
            <Button asChild variant="outline">
              <Link to="/reports">{t('nav.reports')}</Link>
            </Button>
          ) : null}
          {hasPermission(user, 'sale.create') ? (
            <Button asChild>
              <Link to={billingPath(user)}>
                <Plus className="mr-1 size-4" />
                {t('nav.newSale')}
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <section
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label={t('dashboard.todaySummary')}
      >
        {data.sales?.today_total !== undefined ? (
          <StatTile
            label={t('dashboard.todayCollection')}
            valuePaisa={toPaisa(data.sales.today_total)}
            icon={Banknote}
            tint="green"
            trend={yesterdayTrend(
              data.sales.last_30_days ?? [],
              data.business_date_bs,
              t('dashboard.vsYesterday'),
            )}
            caption={t('dashboard.billsCount', { count: data.sales.bill_count })}
            to="/reports/sales"
          />
        ) : null}
        {data.sales ? (
          <StatTile
            label={t('dashboard.billsToday')}
            value={String(data.sales.bill_count)}
            icon={Receipt}
            tint="blue"
            to="/reports/sales"
          />
        ) : null}
        {data.dues ? (
          <StatTile
            label={t('dashboard.duesOutstanding')}
            valuePaisa={toPaisa(data.dues.total_receivable)}
            icon={Wallet}
            tint="amber"
            caption={t('dashboard.customersCount', { count: data.dues.customer_count })}
            to="/reports/dues"
          />
        ) : null}
        {data.low_stock ? (
          <StatTile
            label={t('dashboard.lowStock')}
            value={String(data.low_stock.count)}
            icon={PackageX}
            tint="violet"
            caption={t('dashboard.atOrBelowReorder')}
            to="/reports/stock"
          />
        ) : null}
      </section>

      {data.low_stock && data.low_stock.count > 0 ? (
        <LowStockStrip count={data.low_stock.count} />
      ) : null}

      {isEmptyShop ? (
        <EmptyState
          icon={Receipt}
          title={t('dashboard.emptyTitle')}
          body={t('dashboard.emptyBody')}
          action={
            hasPermission(user, 'sale.create')
              ? { label: t('nav.newSale'), onClick: () => navigate(billingPath(user)) }
              : undefined
          }
        />
      ) : null}

      <section className="grid gap-4 md:grid-cols-2" aria-label={t('dashboard.charts')}>
        {data.sales?.last_30_days ? (
          <ChartCard title={t('dashboard.trend.title')}>
            <SalesTrendChart rows={data.sales.last_30_days} />
          </ChartCard>
        ) : null}
        {canViewSalesReport ? (
          <ChartCard
            title={t('dashboard.collectionsByMethod')}
            subtitle={`${t('dashboard.currentBsMonth')} · BS ${range.dateFromBs} — ${range.dateToBs}`}
          >
            {collections.isPending ? (
              <div className="flex items-center gap-5" aria-busy="true">
                <Skeleton className="h-40 w-40 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ) : collections.isError ? (
              <p role="alert" className="py-8 text-center text-sm text-muted-foreground">
                {t('dashboard.loadError')}
              </p>
            ) : collections.data && collections.data.methods.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t('dashboard.noCollections')}
              </p>
            ) : collections.data ? (
              <ProgressDonut
                data={collections.data.methods.map((m, i) => ({
                  label: m.method,
                  value: Number(m.amount),
                  tint: DONUT_TINTS[i % DONUT_TINTS.length],
                }))}
                centerValue={money(collections.data.total)}
                centerLabel={t('dashboard.thisMonth')}
              />
            ) : null}
          </ChartCard>
        ) : null}
      </section>

      <nav aria-label={t('dashboard.quickActions')}>
        <ul className="grid grid-cols-4 gap-3 sm:gap-4">
          {quickActions(user, canViewReports, t).map((action) => (
            <li key={action.to}>
              <Link
                to={action.to}
                className="flex flex-col items-center gap-2 rounded-xl border bg-card p-3 shadow-card transition-shadow hover:shadow-md sm:p-4"
              >
                <span className={quickChipClass(action.tint)}>
                  <action.icon />
                </span>
                <span className="text-center text-xs font-medium text-foreground">
                  {action.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {data.recent_bills ? (
        <RecentBills bills={data.recent_bills} canViewSalesReport={canViewSalesReport} />
      ) : null}
    </main>
  );
}

/** Trend vs the previous day in the 30-day series; undefined when the
 *  series has no yesterday (or yesterday was zero) — never invented. */
function yesterdayTrend(
  rows: Array<{ business_date_bs: string; net_total: string }>,
  todayBs: string,
  label: string,
): { percent: number; label: string } | undefined {
  const index = rows.findIndex((row) => row.business_date_bs === todayBs);
  if (index < 1) {
    return undefined;
  }
  const today = toPaisa(rows[index].net_total);
  const yesterday = toPaisa(rows[index - 1].net_total);
  if (yesterday === 0) {
    return undefined;
  }
  return { percent: ((today - yesterday) / yesterday) * 100, label };
}

interface QuickAction {
  to: string;
  icon: LucideIcon;
  tint: StatTileTint;
  label: string;
}

function quickChipClass(tint: StatTileTint): string {
  const tintClasses: Record<StatTileTint, string> = {
    green: 'bg-tint-green text-tint-green-foreground',
    blue: 'bg-tint-blue text-tint-blue-foreground',
    amber: 'bg-tint-amber text-tint-amber-foreground',
    rose: 'bg-tint-rose text-tint-rose-foreground',
    violet: 'bg-tint-violet text-tint-violet-foreground',
  };
  return `flex h-10 w-10 items-center justify-center rounded-xl [&_svg]:size-5 ${tintClasses[tint]}`;
}

function quickActions(
  user: ReturnType<typeof useAuth>['user'],
  canViewReports: boolean,
  t: (key: string) => string,
): QuickAction[] {
  const actions: QuickAction[] = [];
  if (hasPermission(user, 'sale.create')) {
    actions.push({ to: billingPath(user), icon: Plus, tint: 'green', label: t('nav.newSale') });
  }
  if (hasPermission(user, 'stock.adjust')) {
    actions.push({ to: '/stock', icon: Package, tint: 'blue', label: t('nav.stock') });
  }
  if (canViewReports) {
    actions.push({ to: '/reports', icon: ChartBar, tint: 'violet', label: t('nav.reports') });
  }
  if (hasPermission(user, 'report.ledger')) {
    actions.push({ to: '/customers', icon: Users, tint: 'amber', label: t('nav.customers') });
  }
  return actions;
}

function DashboardSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <StatTile key={i} label="" icon={Banknote} isLoading />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
      <Skeleton className="h-40 w-full" />
    </main>
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
  useMoneyDisplay();
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
        <p className="py-6 text-center text-sm text-muted-foreground">{t('dashboard.noBills')}</p>
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
              <div className="flex items-center gap-2">
                {bill.tender_methods.length > 0 ? (
                  bill.tender_methods.map((method) => (
                    <Badge key={method} variant="secondary">
                      {method}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline">{t('dashboard.credit')}</Badge>
                )}
                <div className="text-right">
                  <p className="font-medium">{money(bill.total)}</p>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={bill.created_at}>
                      {new Date(bill.created_at).toLocaleString()}
                    </time>
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
