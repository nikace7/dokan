import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { listLevels } from '@/features/inventory/api';
import { OpeningStockDialog } from '@/features/inventory/OpeningStockDialog';
import { formatNpr } from '@/lib/money';

/**
 * Stock screen — the stock_level projection. Levels are read-only here by
 * design (invariant 1): stock changes only via ledger movements, so the
 * single write action is "Add opening stock".
 */
export function StockPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const levelsQuery = useQuery({
    queryKey: ['inventory', 'levels', search, page],
    queryFn: () => listLevels({ search: search.trim() || undefined, page }),
  });

  const levels = levelsQuery.data?.data ?? [];
  const meta = levelsQuery.data?.meta ?? null;
  const showCost = levels.some((level) => level.avg_cost !== undefined);

  return (
    <main className="mx-auto max-w-6xl p-4">
      <Card
        title="Stock / स्टक"
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Add opening stock
          </Button>
        }
      >
        <input
          aria-label="Search stock"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by item name or SKU…"
          className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:max-w-sm"
        />

        {levelsQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {levelsQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {levelsQuery.error instanceof Error
              ? levelsQuery.error.message
              : 'Failed to load stock levels.'}
          </p>
        ) : null}
        {levelsQuery.data && levels.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No stock yet — post opening stock to get started.
          </p>
        ) : null}

        {levels.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2 font-medium">Item</th>
                <th className="py-2 pr-2 font-medium">SKU</th>
                <th className="py-2 pr-2 font-medium">Branch</th>
                <th className="py-2 pr-2 text-right font-medium">On hand</th>
                <th className="py-2 pr-2 text-right font-medium">Reserved</th>
                {showCost ? <th className="py-2 pr-2 text-right font-medium">Avg cost</th> : null}
                <th className="py-2 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level) => {
                const out = Number(level.qty_on_hand) <= 0;
                return (
                  <tr key={level.id} className="border-b border-slate-100">
                    <td className="py-2 pr-2 font-medium">{level.item_name}</td>
                    <td className="py-2 pr-2 text-slate-600">{level.variant_sku}</td>
                    <td className="py-2 pr-2 text-slate-600">{level.branch_code}</td>
                    <td className="py-2 pr-2 text-right">{level.qty_on_hand}</td>
                    <td className="py-2 pr-2 text-right text-slate-600">{level.qty_reserved}</td>
                    {showCost ? (
                      <td className="py-2 pr-2 text-right">
                        {level.avg_cost !== undefined ? formatNpr(level.avg_cost) : '—'}
                      </td>
                    ) : null}
                    <td className="py-2">
                      {out ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          Out of stock
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}

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

      {dialogOpen ? (
        <OpeningStockDialog
          onClose={() => setDialogOpen(false)}
          onPosted={() => {
            setDialogOpen(false);
            void queryClient.invalidateQueries({ queryKey: ['inventory', 'levels'] });
          }}
        />
      ) : null}
    </main>
  );
}
