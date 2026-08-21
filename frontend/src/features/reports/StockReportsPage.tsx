import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { TableCell } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchDeadStock, fetchLowStock, fetchStockSummary } from '@/features/reports/api';
import type { DeadStockRow, LowStockRow, StockSummaryRow } from '@/features/reports/api';
import { MoneyCell, ReportError, ReportTable, TableSkeleton } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { formatNpr, useMoneyDisplay } from '@/lib/money';

type Tab = 'summary' | 'low' | 'dead';

function money(amount: string | null | undefined): string {
  return amount == null ? '—' : formatNpr(amount, { symbol: '' });
}

/**
 * Stock reports — summary (with valuation only when the backend exposes
 * cost), low stock against reorder levels, and dead stock.
 */
export function StockReportsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('summary');
  const [days, setDays] = useState(90);
  const [page, setPage] = useState(1);

  const summaryQuery = useQuery({
    queryKey: ['reports', 'stock-summary', page],
    queryFn: () => fetchStockSummary(page),
    enabled: tab === 'summary',
  });
  const lowQuery = useQuery({
    queryKey: ['reports', 'low-stock', page],
    queryFn: () => fetchLowStock(page),
    enabled: tab === 'low',
  });
  const deadQuery = useQuery({
    queryKey: ['reports', 'dead-stock', days, page],
    queryFn: () => fetchDeadStock(days, page),
    enabled: tab === 'dead',
  });

  const activeQuery = tab === 'summary' ? summaryQuery : tab === 'low' ? lowQuery : deadQuery;
  const meta = activeQuery.data?.meta ?? null;

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <Card title={t('reports.stock.title')}>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as Tab);
            setPage(1);
          }}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TabsList aria-label={t('reports.stock.typeAria')}>
              <TabsTrigger value="summary">{t('reports.stock.summary')}</TabsTrigger>
              <TabsTrigger value="low">{t('reports.stock.low')}</TabsTrigger>
              <TabsTrigger value="dead">{t('reports.stock.dead')}</TabsTrigger>
            </TabsList>
            {tab === 'dead' ? (
              <Input
                id="dead-days"
                label={t('reports.stock.noSaleDays')}
                type="number"
                min={1}
                value={days}
                onChange={(e) => {
                  setDays(Math.max(1, Number(e.target.value) || 90));
                  setPage(1);
                }}
                className="w-24"
              />
            ) : null}
          </div>

          {activeQuery.isFetching ? <TableSkeleton /> : null}
          {activeQuery.isError ? <ReportError error={activeQuery.error} /> : null}

          <TabsContent value="summary">
            {summaryQuery.data && !summaryQuery.isFetching ? (
              <SummaryTable rows={summaryQuery.data.data} />
            ) : null}
          </TabsContent>
          <TabsContent value="low">
            {lowQuery.data && !lowQuery.isFetching ? <LowTable rows={lowQuery.data.data} /> : null}
          </TabsContent>
          <TabsContent value="dead">
            {deadQuery.data && !deadQuery.isFetching ? (
              <DeadTable rows={deadQuery.data.data} />
            ) : null}
          </TabsContent>
        </Tabs>

        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('reports.pageInfo', {
                page: meta.page,
                pages: meta.total_pages,
                count: meta.count,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('common.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </main>
  );
}

function SummaryTable({ rows }: { rows: StockSummaryRow[] }) {
  const { t } = useTranslation();
  useMoneyDisplay();
  // The backend includes cost columns only for pricing.view_cost users.
  const showCost = rows.some((row) => row.avg_cost !== undefined);
  const columns: ReportColumn[] = [
    { header: t('reports.columns.sku') },
    { header: t('reports.columns.item') },
    { header: t('reports.columns.branch') },
    { header: t('reports.columns.onHand'), className: 'text-right' },
    { header: t('reports.columns.mrp'), className: 'text-right' },
    { header: t('reports.columns.mrpValue'), className: 'text-right' },
  ];
  if (showCost) {
    columns.push(
      { header: t('reports.columns.avgCost'), className: 'text-right' },
      { header: t('reports.columns.costValue'), className: 'text-right' },
    );
  }
  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.variant_id}:${row.branch_id}`}
      empty={t('reports.stock.emptySummary')}
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.sku}</TableCell>
          <TableCell>{row.item_name}</TableCell>
          <TableCell className="text-muted-foreground">{row.branch_code}</TableCell>
          <TableCell className="text-right tabular-nums">{row.qty_on_hand}</TableCell>
          <MoneyCell>{money(row.mrp)}</MoneyCell>
          <MoneyCell>{money(row.mrp_valuation)}</MoneyCell>
          {showCost ? <MoneyCell>{money(row.avg_cost)}</MoneyCell> : null}
          {showCost ? <MoneyCell>{money(row.cost_valuation)}</MoneyCell> : null}
        </>
      )}
      renderCard={(row) => (
        <div className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{row.item_name}</p>
            <p className="truncate text-muted-foreground">
              {row.sku} · {row.branch_code}
              {showCost && row.avg_cost !== undefined
                ? ` · ${t('reports.stock.costValue', { amount: money(row.cost_valuation) })}`
                : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold tabular-nums">{row.qty_on_hand}</p>
            <p className="text-xs text-muted-foreground">MRP {money(row.mrp)}</p>
          </div>
        </div>
      )}
    />
  );
}

function LowTable({ rows }: { rows: LowStockRow[] }) {
  const { t } = useTranslation();
  const columns: readonly ReportColumn[] = [
    { header: t('reports.columns.sku') },
    { header: t('reports.columns.item') },
    { header: t('reports.columns.onHand'), className: 'text-right' },
    { header: t('reports.columns.reorderLevel'), className: 'text-right' },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.variant_id}:${row.branch_id}`}
      empty={t('reports.stock.emptyLow')}
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.sku}</TableCell>
          <TableCell>{row.item_name}</TableCell>
          <TableCell className="text-right tabular-nums">
            <Badge variant="warning">{row.qty_on_hand}</Badge>
          </TableCell>
          <TableCell className="text-right tabular-nums">{row.reorder_level}</TableCell>
        </>
      )}
      renderCard={(row) => (
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{row.item_name}</p>
            <p className="truncate text-muted-foreground">
              {row.sku} · {t('reports.stock.reorderAt', { level: row.reorder_level })}
            </p>
          </div>
          <Badge variant="warning">{t('reports.stock.qtyLeft', { count: row.qty_on_hand })}</Badge>
        </div>
      )}
    />
  );
}

function DeadTable({ rows }: { rows: DeadStockRow[] }) {
  const { t } = useTranslation();
  const columns: readonly ReportColumn[] = [
    { header: t('reports.columns.sku') },
    { header: t('reports.columns.item') },
    { header: t('reports.columns.onHand'), className: 'text-right' },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.variant_id}:${row.branch_id}`}
      empty={t('reports.stock.emptyDead')}
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.sku}</TableCell>
          <TableCell>{row.item_name}</TableCell>
          <TableCell className="text-right tabular-nums">{row.qty_on_hand}</TableCell>
        </>
      )}
      renderCard={(row) => (
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{row.item_name}</p>
            <p className="truncate text-muted-foreground">{row.sku}</p>
          </div>
          <p className="font-semibold tabular-nums">
            {t('reports.stock.qtyOnHand', { count: row.qty_on_hand })}
          </p>
        </div>
      )}
    />
  );
}
