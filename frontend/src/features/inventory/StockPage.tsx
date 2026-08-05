import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/useAuth';
import { listLevels, listMovements } from '@/features/inventory/api';
import { OpeningStockDialog } from '@/features/inventory/OpeningStockDialog';
import { StockOperationDialog } from '@/features/inventory/StockOperationDialog';
import { formatNpr } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';

type Dialog = 'opening' | 'adjustment' | 'write-off' | null;

export function StockPage() {
  const { user, isRestoring } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [movementPage, setMovementPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const canView = hasPermission(user, 'stock.view');
  const canAdjust = hasPermission(user, 'stock.adjust');

  const levelsQuery = useQuery({
    queryKey: ['inventory', 'levels', search, page],
    queryFn: () => listLevels({ search: search.trim() || undefined, page }),
    enabled: canView,
  });
  const movementsQuery = useQuery({
    queryKey: ['inventory', 'movements', movementPage],
    queryFn: () => listMovements({ page: movementPage }),
    enabled: canView,
  });

  if (isRestoring || !user) {
    return <main className="mx-auto max-w-6xl p-4 text-sm text-slate-500">Loading…</main>;
  }
  if (!canView) {
    return (
      <main className="mx-auto max-w-6xl p-4">
        <p role="alert">You do not have permission to view stock.</p>
      </main>
    );
  }

  const levels = levelsQuery.data?.data ?? [];
  const movements = movementsQuery.data?.data ?? [];
  const showCost = levels.some((level) => level.avg_cost !== undefined);
  const posted = () => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ['inventory', 'levels'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
  };

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <Card
        title="Stock / स्टक"
        actions={
          canAdjust ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDialog('adjustment')}>
                Adjust stock
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog('write-off')}>
                Write off damage
              </Button>
              <Button size="sm" onClick={() => setDialog('opening')}>
                Add opening stock
              </Button>
            </div>
          ) : undefined
        }
      >
        <input
          aria-label="Search stock"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search by item name or SKU…"
          className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:max-w-sm"
        />

        {levelsQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {levelsQuery.isError ? (
          <QueryError error={levelsQuery.error} fallback="Failed to load stock levels." />
        ) : null}
        {levelsQuery.data && levels.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No stock yet.</p>
        ) : null}

        {levels.length > 0 ? (
          <div className="overflow-x-auto">
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
                {levels.map((level) => (
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
                      {Number(level.qty_on_hand) <= 0 ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          Out of stock
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <Pagination meta={levelsQuery.data?.meta} page={page} setPage={setPage} />
      </Card>

      <Card title="Movement ledger / मौज्दात गतिविधि">
        <p className="mb-3 text-sm text-slate-500">Immutable history of every stock change.</p>
        {movementsQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {movementsQuery.isError ? (
          <QueryError error={movementsQuery.error} fallback="Failed to load stock movements." />
        ) : null}
        {movementsQuery.data && movements.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No stock movements yet.</p>
        ) : null}
        {movements.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2 font-medium">BS date</th>
                  <th className="py-2 pr-2 font-medium">Type</th>
                  <th className="py-2 pr-2 font-medium">SKU</th>
                  <th className="py-2 pr-2 font-medium">Branch</th>
                  <th className="py-2 pr-2 text-right font-medium">Change</th>
                  <th className="py-2 pr-2 text-right font-medium">Balance</th>
                  <th className="py-2 pr-2 font-medium">Reason / note</th>
                  <th className="py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id} className="border-b border-slate-100">
                    <td className="py-2 pr-2">{movement.business_date_bs}</td>
                    <td className="py-2 pr-2 font-medium">{movement.type}</td>
                    <td className="py-2 pr-2 text-slate-600">{movement.variant_sku}</td>
                    <td className="py-2 pr-2 text-slate-600">{movement.branch_code}</td>
                    <td
                      className={`py-2 pr-2 text-right ${Number(movement.qty_delta) < 0 ? 'text-red-700' : 'text-green-700'}`}
                    >
                      {movement.qty_delta}
                    </td>
                    <td className="py-2 pr-2 text-right">{movement.balance_after}</td>
                    <td className="py-2 pr-2">{movement.note || '—'}</td>
                    <td className="py-2">{movement.created_by_name || 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <Pagination
          meta={movementsQuery.data?.meta}
          page={movementPage}
          setPage={setMovementPage}
        />
      </Card>

      {dialog === 'opening' ? (
        <OpeningStockDialog onClose={() => setDialog(null)} onPosted={posted} />
      ) : null}
      {dialog === 'adjustment' || dialog === 'write-off' ? (
        <StockOperationDialog kind={dialog} onClose={() => setDialog(null)} onPosted={posted} />
      ) : null}
    </main>
  );
}

function QueryError({ error, fallback }: { error: unknown; fallback: string }) {
  return (
    <p role="alert" className="py-4 text-sm text-red-600">
      {error instanceof Error ? error.message : fallback}
    </p>
  );
}

interface PaginationProps {
  meta: { count: number; page: number; total_pages: number } | null | undefined;
  page: number;
  setPage: (page: number | ((current: number) => number)) => void;
}

function Pagination({ meta, page, setPage }: PaginationProps) {
  if (!meta || meta.total_pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-slate-500">
        Page {meta.page} of {meta.total_pages} ({meta.count} rows)
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((current) => current - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={meta.page >= meta.total_pages}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
