import { Banknote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/StatTile';
import type { DashboardBill } from '@/features/dashboard/api';
import { formatNpr, useMoneyDisplay } from '@/lib/money';

export function DashboardSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <StatTile key={index} label="" icon={Banknote} isLoading />
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

export function RecentBills({
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
                  <p className="font-medium">{formatNpr(bill.total).replace(/\.00$/, '')}</p>
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
