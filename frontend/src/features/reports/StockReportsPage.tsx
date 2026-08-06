import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

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
import { formatNpr } from '@/lib/money';

type Tab = 'summary' | 'low' | 'dead';

function money(amount: string | null | undefined): string {
  return amount == null ? '—' : formatNpr(amount, { symbol: '' });
}

/**
 * Stock reports — summary (with valuation only when the backend exposes
 * cost), low stock against reorder levels, and dead stock.
 */
export function StockReportsPage() {
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
      <Card title="Stock reports / स्टक प्रतिवेदन">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as Tab);
            setPage(1);
          }}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TabsList aria-label="Stock report type">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="low">Low stock</TabsTrigger>
              <TabsTrigger value="dead">Dead stock</TabsTrigger>
            </TabsList>
            {tab === 'dead' ? (
              <Input
                id="dead-days"
                label="No sale in (days)"
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
              Page {meta.page} of {meta.total_pages} ({meta.count} rows)
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </main>
  );
}

function summaryColumns(showCost: boolean): readonly ReportColumn[] {
  const columns: ReportColumn[] = [
    { header: 'SKU' },
    { header: 'Item' },
    { header: 'Branch' },
    { header: 'On hand', className: 'text-right' },
    { header: 'MRP', className: 'text-right' },
    { header: 'MRP value', className: 'text-right' },
  ];
  if (showCost) {
    columns.push(
      { header: 'Avg cost', className: 'text-right' },
      { header: 'Cost value', className: 'text-right' },
    );
  }
  return columns;
}

function SummaryTable({ rows }: { rows: StockSummaryRow[] }) {
  // The backend includes cost columns only for pricing.view_cost users.
  const showCost = rows.some((row) => row.avg_cost !== undefined);
  return (
    <ReportTable
      columns={summaryColumns(showCost)}
      rows={rows}
      rowKey={(row) => `${row.variant_id}:${row.branch_id}`}
      empty="No stock on hand."
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
                ? ` · cost value ${money(row.cost_valuation)}`
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

const LOW_COLUMNS: readonly ReportColumn[] = [
  { header: 'SKU' },
  { header: 'Item' },
  { header: 'On hand', className: 'text-right' },
  { header: 'Reorder level', className: 'text-right' },
];

function LowTable({ rows }: { rows: LowStockRow[] }) {
  return (
    <ReportTable
      columns={LOW_COLUMNS}
      rows={rows}
      rowKey={(row) => `${row.variant_id}:${row.branch_id}`}
      empty="Nothing below its reorder level."
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
              {row.sku} · reorder at {row.reorder_level}
            </p>
          </div>
          <Badge variant="warning">{row.qty_on_hand} left</Badge>
        </div>
      )}
    />
  );
}

const DEAD_COLUMNS: readonly ReportColumn[] = [
  { header: 'SKU' },
  { header: 'Item' },
  { header: 'On hand', className: 'text-right' },
];

function DeadTable({ rows }: { rows: DeadStockRow[] }) {
  return (
    <ReportTable
      columns={DEAD_COLUMNS}
      rows={rows}
      rowKey={(row) => `${row.variant_id}:${row.branch_id}`}
      empty="No dead stock."
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
          <p className="font-semibold tabular-nums">{row.qty_on_hand} on hand</p>
        </div>
      )}
    />
  );
}
