import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { TableCell } from '@/components/ui/table';
import { useAuth } from '@/features/auth/useAuth';
import { listLevels, listMovements } from '@/features/inventory/api';
import { OpeningStockDialog } from '@/features/inventory/OpeningStockDialog';
import { StockOperationDialog } from '@/features/inventory/StockOperationDialog';
import { ReportTable } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { formatNpr } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';
import { hasPlanFeature } from '@/lib/plans';
import { cn } from '@/lib/utils';

type Dialog = 'opening' | 'adjustment' | 'write-off' | null;

const LEVEL_COLUMNS: readonly ReportColumn[] = [
  { header: 'Item' },
  { header: 'SKU' },
  { header: 'Branch' },
  { header: 'On hand', className: 'text-right' },
  { header: 'Reserved', className: 'text-right' },
];

const MOVEMENT_COLUMNS: readonly ReportColumn[] = [
  { header: 'BS date' },
  { header: 'Type' },
  { header: 'SKU' },
  { header: 'Branch' },
  { header: 'Change', className: 'text-right' },
  { header: 'Balance', className: 'text-right' },
  { header: 'Reason / note' },
  { header: 'By' },
];

export function StockPage() {
  const { user, isRestoring } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [movementPage, setMovementPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const canView = hasPermission(user, 'stock.view');
  const canAdjust = hasPermission(user, 'stock.adjust');
  const canTransfer = hasPlanFeature(user, 'multi_branch');

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
    return (
      <main className="mx-auto max-w-6xl p-4 text-sm text-muted-foreground">Loading…</main>
    );
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
  const levelColumns: readonly ReportColumn[] = showCost
    ? [...LEVEL_COLUMNS, { header: 'Avg cost', className: 'text-right' }, { header: 'Flag' }]
    : [...LEVEL_COLUMNS, { header: 'Flag' }];
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
          <div className="flex flex-wrap gap-2">
            {canTransfer ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/stock/transfers">Transfers</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link to="/stock/counts">Physical counts</Link>
            </Button>
            {canAdjust ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setDialog('adjustment')}>
                  Adjust stock
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setDialog('write-off')}>
                  Write off damage
                </Button>
                <Button size="sm" onClick={() => setDialog('opening')}>
                  Add opening stock
                </Button>
              </>
            ) : null}
          </div>
        }
      >
        <Input
          aria-label="Search stock"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search by item name or SKU…"
          className="mb-4 sm:max-w-sm"
        />

        {levelsQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        ) : null}
        {levelsQuery.isError ? (
          <QueryError error={levelsQuery.error} fallback="Failed to load stock levels." />
        ) : null}

        {levelsQuery.data ? (
          <ReportTable
            columns={levelColumns}
            rows={levels}
            rowKey={(level) => level.id}
            empty="No stock yet."
            renderCells={(level) => (
              <>
                <TableCell className="font-medium">{level.item_name}</TableCell>
                <TableCell className="text-muted-foreground">{level.variant_sku}</TableCell>
                <TableCell className="text-muted-foreground">{level.branch_code}</TableCell>
                <TableCell className="text-right tabular-nums">{level.qty_on_hand}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {level.qty_reserved}
                </TableCell>
                {showCost ? (
                  <TableCell className="text-right tabular-nums">
                    {level.avg_cost !== undefined ? formatNpr(level.avg_cost) : '—'}
                  </TableCell>
                ) : null}
                <TableCell>
                  {Number(level.qty_on_hand) <= 0 ? (
                    <Badge variant="destructive">Out of stock</Badge>
                  ) : null}
                </TableCell>
              </>
            )}
            renderCard={(level) => (
              <div className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{level.item_name}</p>
                  <p className="text-muted-foreground">
                    {level.variant_sku} · {level.branch_code}
                  </p>
                  {showCost && level.avg_cost !== undefined ? (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Cost {formatNpr(level.avg_cost)}
                    </p>
                  ) : null}
                  {Number(level.qty_on_hand) <= 0 ? (
                    <Badge variant="destructive" className="mt-1">
                      Out of stock
                    </Badge>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums">{level.qty_on_hand}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Reserved {level.qty_reserved}
                  </p>
                </div>
              </div>
            )}
          />
        ) : null}
        <Pagination meta={levelsQuery.data?.meta} page={page} setPage={setPage} />
      </Card>

      <Card title="Movement ledger / मौज्दात गतिविधि">
        <p className="mb-3 text-sm text-muted-foreground">
          Immutable history of every stock change.
        </p>
        {movementsQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        ) : null}
        {movementsQuery.isError ? (
          <QueryError error={movementsQuery.error} fallback="Failed to load stock movements." />
        ) : null}
        {movementsQuery.data ? (
          <ReportTable
            columns={MOVEMENT_COLUMNS}
            rows={movements}
            rowKey={(movement) => movement.id}
            empty="No stock movements yet."
            renderCells={(movement) => (
              <>
                <TableCell>{movement.business_date_bs}</TableCell>
                <TableCell className="font-medium">{movement.type}</TableCell>
                <TableCell className="text-muted-foreground">{movement.variant_sku}</TableCell>
                <TableCell className="text-muted-foreground">{movement.branch_code}</TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    Number(movement.qty_delta) < 0 ? 'text-destructive' : 'text-success',
                  )}
                >
                  {movement.qty_delta}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {movement.balance_after}
                </TableCell>
                <TableCell>{movement.note || '—'}</TableCell>
                <TableCell>{movement.created_by_name || 'System'}</TableCell>
              </>
            )}
            renderCard={(movement) => (
              <div className="text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{movement.type}</p>
                  <p
                    className={cn(
                      'shrink-0 font-medium tabular-nums',
                      Number(movement.qty_delta) < 0 ? 'text-destructive' : 'text-success',
                    )}
                  >
                    {movement.qty_delta}
                  </p>
                </div>
                <p className="text-muted-foreground">
                  {movement.business_date_bs} · {movement.variant_sku} · {movement.branch_code}
                </p>
                <p className="text-muted-foreground">
                  Balance {movement.balance_after} · {movement.note || '—'} ·{' '}
                  {movement.created_by_name || 'System'}
                </p>
              </div>
            )}
          />
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
    <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
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
      <span className="text-muted-foreground">
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
