import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TableCell } from '@/components/ui/table';
import { listPriceChanges, listPrices } from '@/features/pricing/api';
import { ReportTable } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { formatNpr } from '@/lib/money';

function target(row: {
  scope?: string;
  target_type?: string;
  variant?: string | null;
  item?: string | null;
  category?: string | null;
  target_id?: string;
}) {
  return `${row.scope ?? row.target_type} · ${row.variant ?? row.item ?? row.category ?? row.target_id ?? '—'}`;
}

export function PriceTables() {
  const { t } = useTranslation();
  const [pricePage, setPricePage] = useState(1);
  const [changePage, setChangePage] = useState(1);
  const prices = useQuery({
    queryKey: ['pricing', 'prices', pricePage],
    queryFn: () => listPrices({ page: pricePage }),
  });
  const changes = useQuery({
    queryKey: ['pricing', 'changes', changePage],
    queryFn: () => listPriceChanges(changePage),
  });

  const priceColumns: readonly ReportColumn[] = [
    { header: t('pricing.tables.columns.target') },
    { header: t('pricing.tables.columns.rate') },
    { header: t('pricing.tables.columns.price'), className: 'text-right' },
    { header: t('pricing.tables.columns.effectiveDates') },
  ];
  const changeColumns: readonly ReportColumn[] = [
    { header: t('pricing.tables.columns.target') },
    { header: t('pricing.tables.columns.rate') },
    { header: t('pricing.tables.columns.change') },
    { header: t('pricing.tables.columns.actorReason') },
    { header: t('pricing.tables.columns.when') },
  ];

  return (
    <>
      <Card title={t('pricing.tables.pricesTitle')}>
        {prices.isPending ? (
          <p className="text-sm text-muted-foreground">{t('pricing.tables.loadingPrices')}</p>
        ) : null}
        {prices.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {prices.error instanceof Error ? prices.error.message : t('pricing.tables.pricesError')}
          </p>
        ) : null}
        {prices.data ? (
          <ReportTable
            columns={priceColumns}
            rows={prices.data.data}
            rowKey={(row) => row.id}
            empty={t('pricing.tables.emptyPrices')}
            renderCells={(row) => (
              <>
                <TableCell className="font-mono text-xs">{target(row)}</TableCell>
                <TableCell>{row.rate_type_code}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatNpr(row.price)}
                </TableCell>
                <TableCell>
                  {row.effective_from} → {row.effective_to ?? t('pricing.tables.open')}
                </TableCell>
              </>
            )}
            renderCard={(row) => (
              <div className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-mono text-xs">{target(row)}</p>
                  <p className="text-muted-foreground">
                    {row.rate_type_code} · {row.effective_from} →{' '}
                    {row.effective_to ?? t('pricing.tables.open')}
                  </p>
                </div>
                <p className="shrink-0 text-right font-medium tabular-nums">
                  {formatNpr(row.price)}
                </p>
              </div>
            )}
          />
        ) : null}
        <Pager meta={prices.data?.meta ?? undefined} page={pricePage} setPage={setPricePage} />
      </Card>

      <Card title={t('pricing.tables.historyTitle')}>
        {changes.isPending ? (
          <p className="text-sm text-muted-foreground">{t('pricing.tables.loadingHistory')}</p>
        ) : null}
        {changes.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {changes.error instanceof Error
              ? changes.error.message
              : t('pricing.tables.historyError')}
          </p>
        ) : null}
        {changes.data ? (
          <ReportTable
            columns={changeColumns}
            rows={changes.data.data}
            rowKey={(row) => row.id}
            empty={t('pricing.tables.emptyHistory')}
            renderCells={(row) => (
              <>
                <TableCell className="font-mono text-xs">{target(row)}</TableCell>
                <TableCell>{row.rate_type_code ?? '—'}</TableCell>
                <TableCell>
                  {row.old_price ? formatNpr(row.old_price) : t('pricing.tables.unset')} →{' '}
                  {row.new_price ? formatNpr(row.new_price) : t('pricing.tables.unset')}
                </TableCell>
                <TableCell>
                  <span className="block">
                    {row.changed_by_name ?? t('pricing.tables.system')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.reason ?? t('pricing.tables.noReason')}
                  </span>
                </TableCell>
                <TableCell>{new Date(row.created_at).toLocaleString()}</TableCell>
              </>
            )}
            renderCard={(row) => (
              <div className="text-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-mono text-xs">{target(row)}</p>
                  <p className="shrink-0 text-right font-medium tabular-nums">
                    {row.old_price ? formatNpr(row.old_price) : t('pricing.tables.unset')} →{' '}
                    {row.new_price ? formatNpr(row.new_price) : t('pricing.tables.unset')}
                  </p>
                </div>
                <p className="text-muted-foreground">
                  {row.rate_type_code ?? '—'} · {row.changed_by_name ?? t('pricing.tables.system')}{' '}
                  · {new Date(row.created_at).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.reason ?? t('pricing.tables.noReason')}
                </p>
              </div>
            )}
          />
        ) : null}
        <Pager meta={changes.data?.meta ?? undefined} page={changePage} setPage={setChangePage} />
      </Card>
    </>
  );
}

function Pager({
  meta,
  page,
  setPage,
}: {
  meta?: { page: number; total_pages: number };
  page: number;
  setPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (!meta || meta.total_pages <= 1) return null;
  return (
    <div className="mt-3 flex justify-end gap-2">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        {t('common.previous')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= meta.total_pages}
        onClick={() => setPage(page + 1)}
      >
        {t('common.next')}
      </Button>
    </div>
  );
}
