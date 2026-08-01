import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { fetchDeadStock, fetchLowStock, fetchStockSummary } from '@/features/reports/api';
import type { DeadStockRow, LowStockRow, StockSummaryRow } from '@/features/reports/api';
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
    <main className="mx-auto max-w-6xl p-4">
      <Card title="Stock reports / स्टक प्रतिवेदन">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Stock report type" className="flex gap-1">
            {(
              [
                ['summary', 'Summary'],
                ['low', 'Low stock'],
                ['dead', 'Dead stock'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id);
                  setPage(1);
                }}
                className={[
                  'rounded-md px-3 py-2 text-sm font-medium',
                  tab === id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'dead' ? (
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="dead-days" className="font-medium text-slate-700">
                No sale in
              </label>
              <input
                id="dead-days"
                type="number"
                min={1}
                value={days}
                onChange={(e) => {
                  setDays(Math.max(1, Number(e.target.value) || 90));
                  setPage(1);
                }}
                className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <span className="text-slate-600">days</span>
            </div>
          ) : null}
        </div>

        {activeQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {activeQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {activeQuery.error instanceof Error
              ? activeQuery.error.message
              : 'Failed to load the report.'}
          </p>
        ) : null}

        {tab === 'summary' && summaryQuery.data ? (
          <SummaryTable rows={summaryQuery.data.data} />
        ) : null}
        {tab === 'low' && lowQuery.data ? <LowTable rows={lowQuery.data.data} /> : null}
        {tab === 'dead' && deadQuery.data ? <DeadTable rows={deadQuery.data.data} /> : null}

        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
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

function SummaryTable({ rows }: { rows: StockSummaryRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No stock on hand.</p>;
  }
  // The backend includes cost columns only for pricing.view_cost users.
  const showCost = rows.some((row) => row.avg_cost !== undefined);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-2 pr-2 font-medium">SKU</th>
          <th className="py-2 pr-2 font-medium">Item</th>
          <th className="py-2 pr-2 font-medium">Branch</th>
          <th className="py-2 pr-2 text-right font-medium">On hand</th>
          <th className="py-2 pr-2 text-right font-medium">MRP</th>
          <th className="py-2 pr-2 text-right font-medium">MRP value</th>
          {showCost ? <th className="py-2 pr-2 text-right font-medium">Avg cost</th> : null}
          {showCost ? <th className="py-2 text-right font-medium">Cost value</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.variant_id}:${row.branch_id}`} className="border-b border-slate-100">
            <td className="py-2 pr-2 font-medium">{row.sku}</td>
            <td className="py-2 pr-2">{row.item_name}</td>
            <td className="py-2 pr-2 text-slate-600">{row.branch_code}</td>
            <td className="py-2 pr-2 text-right">{row.qty_on_hand}</td>
            <td className="py-2 pr-2 text-right">{money(row.mrp)}</td>
            <td className="py-2 pr-2 text-right">{money(row.mrp_valuation)}</td>
            {showCost ? <td className="py-2 pr-2 text-right">{money(row.avg_cost)}</td> : null}
            {showCost ? <td className="py-2 text-right">{money(row.cost_valuation)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LowTable({ rows }: { rows: LowStockRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        Nothing below its reorder level. 
      </p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-2 pr-2 font-medium">SKU</th>
          <th className="py-2 pr-2 font-medium">Item</th>
          <th className="py-2 pr-2 text-right font-medium">On hand</th>
          <th className="py-2 text-right font-medium">Reorder level</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.variant_id}:${row.branch_id}`} className="border-b border-slate-100">
            <td className="py-2 pr-2 font-medium">{row.sku}</td>
            <td className="py-2 pr-2">{row.item_name}</td>
            <td className="py-2 pr-2 text-right text-red-700">{row.qty_on_hand}</td>
            <td className="py-2 text-right">{row.reorder_level}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeadTable({ rows }: { rows: DeadStockRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No dead stock. </p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-2 pr-2 font-medium">SKU</th>
          <th className="py-2 pr-2 font-medium">Item</th>
          <th className="py-2 text-right font-medium">On hand</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.variant_id}:${row.branch_id}`} className="border-b border-slate-100">
            <td className="py-2 pr-2 font-medium">{row.sku}</td>
            <td className="py-2 pr-2">{row.item_name}</td>
            <td className="py-2 text-right">{row.qty_on_hand}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
