import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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

export function StockPage() {
  const { t } = useTranslation();
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
      <main className="mx-auto max-w-6xl p-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </main>
    );
  }
  if (!canView) {
    return (
      <main className="mx-auto max-w-6xl p-4">
        <p role="alert">{t('inventory.noPermission')}</p>
      </main>
    );
  }

  const levels = levelsQuery.data?.data ?? [];
  const movements = movementsQuery.data?.data ?? [];
  const showCost = levels.some((level) => level.avg_cost !== undefined);
  const baseLevelColumns: readonly ReportColumn[] = [
    { header: t('inventory.stock.columns.item') },
    { header: t('inventory.stock.columns.sku') },
    { header: t('inventory.stock.columns.branch') },
    { header: t('inventory.stock.columns.onHand'), className: 'text-right' },
    { header: t('inventory.stock.columns.reserved'), className: 'text-right' },
  ];
  const levelColumns: readonly ReportColumn[] = showCost
    ? [
        ...baseLevelColumns,
        { header: t('inventory.stock.columns.avgCost'), className: 'text-right' },
        { header: t('inventory.stock.columns.flag') },
      ]
    : [...baseLevelColumns, { header: t('inventory.stock.columns.flag') }];
  const movementColumns: readonly ReportColumn[] = [
    { header: t('inventory.movements.columns.bsDate') },
    { header: t('inventory.movements.columns.type') },
    { header: t('inventory.movements.columns.sku') },
    { header: t('inventory.movements.columns.branch') },
    { header: t('inventory.movements.columns.change'), className: 'text-right' },
    { header: t('inventory.movements.columns.balance'), className: 'text-right' },
    { header: t('inventory.movements.columns.reasonNote') },
    { header: t('inventory.movements.columns.by') },
  ];
  const posted = () => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ['inventory', 'levels'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
  };

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <Card
        title={t('inventory.stock.title')}
        actions={
          <div className="flex flex-wrap gap-2">
            {canTransfer ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/stock/transfers">{t('nav.transfers')}</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link to="/stock/counts">{t('inventory.stock.physicalCounts')}</Link>
            </Button>
            {canAdjust ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setDialog('adjustment')}>
                  {t('inventory.stock.adjust')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setDialog('write-off')}>
                  {t('inventory.stock.writeOff')}
                </Button>
                <Button size="sm" onClick={() => setDialog('opening')}>
                  {t('inventory.stock.addOpening')}
                </Button>
              </>
            ) : null}
          </div>
        }
      >
        <Input
          aria-label={t('inventory.stock.searchAria')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t('inventory.stock.searchPlaceholder')}
          className="mb-4 sm:max-w-sm"
        />

        {levelsQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {levelsQuery.isError ? (
          <QueryError error={levelsQuery.error} fallback={t('inventory.stock.levelsError')} />
        ) : null}

        {levelsQuery.data ? (
          <ReportTable
            columns={levelColumns}
            rows={levels}
            rowKey={(level) => level.id}
            empty={t('inventory.stock.emptyLevels')}
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
                    <Badge variant="destructive">{t('inventory.stock.outOfStock')}</Badge>
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
                      {t('inventory.stock.costAmount', { amount: formatNpr(level.avg_cost) })}
                    </p>
                  ) : null}
                  {Number(level.qty_on_hand) <= 0 ? (
                    <Badge variant="destructive" className="mt-1">
                      {t('inventory.stock.outOfStock')}
                    </Badge>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums">{level.qty_on_hand}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t('inventory.stock.reserved', { qty: level.qty_reserved })}
                  </p>
                </div>
              </div>
            )}
          />
        ) : null}
        <Pagination meta={levelsQuery.data?.meta} page={page} setPage={setPage} />
      </Card>

      <Card title={t('inventory.movements.title')}>
        <p className="mb-3 text-sm text-muted-foreground">
          {t('inventory.movements.subtitle')}
        </p>
        {movementsQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {movementsQuery.isError ? (
          <QueryError error={movementsQuery.error} fallback={t('inventory.stock.movementsError')} />
        ) : null}
        {movementsQuery.data ? (
          <ReportTable
            columns={movementColumns}
            rows={movements}
            rowKey={(movement) => movement.id}
            empty={t('inventory.movements.empty')}
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
                <TableCell>{movement.created_by_name || t('inventory.system')}</TableCell>
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
                  {t('inventory.movements.balance', { qty: movement.balance_after })} ·{' '}
                  {movement.note || '—'} · {movement.created_by_name || t('inventory.system')}
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
  const { t } = useTranslation();
  if (!meta || meta.total_pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        {t('reports.pageInfo', { page: meta.page, pages: meta.total_pages, count: meta.count })}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((current) => current - 1)}
        >
          {t('common.previous')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={meta.page >= meta.total_pages}
          onClick={() => setPage((current) => current + 1)}
        >
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}
