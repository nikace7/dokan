import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { TableCell } from '@/components/ui/table';
import { currentBsMonthRange, fetchProfit } from '@/features/reports/api';
import type { BsRange, ProfitReport, ProfitRow } from '@/features/reports/api';
import { BsRangeControls } from '@/features/reports/BsRangeControls';
import { MoneyCell, ReportError, ReportTable, TableSkeleton } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

/**
 * Profit report — revenue / COGS / gross (and net when the backend subtracts
 * expenses) by BS month. The backend requires report.profit AND cost
 * visibility; a 403 means "owner only" and gets a friendly panel, not an
 * error dump (invariant 10).
 */
export function ProfitReportPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<BsRange>(currentBsMonthRange);

  const query = useQuery({
    queryKey: ['reports', 'profit', range],
    queryFn: () => fetchProfit(range),
    retry: false,
  });

  const forbidden = query.error instanceof ApiError && query.error.status === 403;

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <Card title={t('reports.profit.title')}>
        <div className="mb-4">
          <BsRangeControls value={range} onApply={setRange} />
        </div>

        {forbidden ? (
          <div className="rounded-md border bg-muted/50 px-4 py-8 text-center">
            <p className="text-base font-medium">{t('reports.profit.ownerOnly')}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('reports.profit.ownerOnlyBody')}
            </p>
          </div>
        ) : null}

        {!forbidden && query.isError ? <ReportError error={query.error} /> : null}
        {query.isFetching ? <TableSkeleton /> : null}

        {query.data && !query.isFetching ? <ProfitResults data={query.data} /> : null}
      </Card>
    </main>
  );
}

function ProfitResults({ data }: { data: ProfitReport }) {
  const { t } = useTranslation();
  const hasNet = data.totals.net_profit !== undefined;
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('reports.profit.revenue')} value={data.totals.revenue} />
        <StatCard label={t('reports.profit.costOfGoods')} value={data.totals.cogs} />
        <StatCard label={t('reports.profit.grossProfit')} value={data.totals.gross_profit} highlight />
        {hasNet ? (
          <StatCard
            label={t('reports.profit.netProfit')}
            value={data.totals.net_profit ?? '0.00'}
            highlight
          />
        ) : null}
      </div>
      <ProfitTable rows={data.rows} hasNet={hasNet} />
    </>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? 'rounded-lg border border-success/30 bg-success/10 px-4 py-3'
          : 'rounded-lg border bg-muted/50 px-4 py-3'
      }
    >
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums sm:text-xl">{formatNpr(value)}</p>
    </div>
  );
}

function ProfitTable({ rows, hasNet }: { rows: ProfitRow[]; hasNet: boolean }) {
  const { t } = useTranslation();
  const money = (amount: string | undefined) => formatNpr(amount ?? '0.00', { symbol: '' });
  const columns: ReportColumn[] = [
    { header: t('reports.columns.bsMonth') },
    { header: t('reports.columns.sales'), className: 'text-right' },
    { header: t('reports.columns.returns'), className: 'text-right' },
    { header: t('reports.columns.revenue'), className: 'text-right' },
    { header: t('reports.columns.cogs'), className: 'text-right' },
    { header: t('reports.profit.grossProfit'), className: 'text-right' },
  ];
  if (hasNet) {
    columns.push(
      { header: t('reports.columns.expenses'), className: 'text-right' },
      { header: t('reports.profit.netProfit'), className: 'text-right' },
    );
  }
  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.bs_month}
      empty={t('reports.noSalesInRange')}
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.bs_month}</TableCell>
          <MoneyCell>{money(row.sales_total)}</MoneyCell>
          <MoneyCell>{money(row.returns_total)}</MoneyCell>
          <MoneyCell>{money(row.revenue)}</MoneyCell>
          <MoneyCell>{money(row.cogs)}</MoneyCell>
          <MoneyCell>
            <span className="font-medium">{money(row.gross_profit)}</span>
          </MoneyCell>
          {hasNet ? <MoneyCell>{money(row.expenses)}</MoneyCell> : null}
          {hasNet ? (
            <MoneyCell>
              <span className="font-medium">{money(row.net_profit)}</span>
            </MoneyCell>
          ) : null}
        </>
      )}
      renderCard={(row) => (
        <div className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-medium">{row.bs_month}</p>
            <p className="font-semibold tabular-nums">
              {hasNet ? money(row.net_profit) : money(row.gross_profit)}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('reports.profit.cardRevenue', { amount: money(row.revenue) })} ·{' '}
            {t('reports.profit.cardCogs', { amount: money(row.cogs) })}
            {hasNet ? ` · ${t('reports.profit.cardExpenses', { amount: money(row.expenses) })}` : ''}
          </p>
        </div>
      )}
    />
  );
}
