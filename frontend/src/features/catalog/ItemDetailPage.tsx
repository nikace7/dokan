import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TableCell } from '@/components/ui/table';
import { getItem, listSizeCharts, listVariants } from '@/features/catalog/api';
import { ItemImage } from '@/features/catalog/ui';
import { VariantMatrix } from '@/features/catalog/VariantMatrix';
import { ReportTable } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { formatNpr } from '@/lib/money';

/**
 * Item detail: summary, existing variants, and the size × colour matrix
 * entry — the natural next step after creating an item.
 */
export function ItemDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const itemQuery = useQuery({
    queryKey: ['catalog', 'items', 'detail', id],
    queryFn: () => getItem(id ?? ''),
    enabled: id !== undefined,
  });
  const variantsQuery = useQuery({
    queryKey: ['catalog', 'variants', id],
    queryFn: () => listVariants(id ?? ''),
    enabled: id !== undefined,
  });
  // The matrix's size checkboxes come from the item's size chart values.
  const sizeChartsQuery = useQuery({
    queryKey: ['catalog', 'size-charts'],
    queryFn: listSizeCharts,
    staleTime: 5 * 60_000,
  });

  if (itemQuery.isPending) {
    return (
      <main className="mx-auto max-w-4xl p-4">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </main>
    );
  }
  if (itemQuery.isError || !itemQuery.data) {
    return (
      <main className="mx-auto max-w-4xl p-4">
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {itemQuery.error instanceof Error ? itemQuery.error.message : t('catalog.detail.notFound')}
        </p>
        <Link className="mt-2 inline-block text-primary hover:underline" to="/catalog">
          {t('catalog.detail.back')}
        </Link>
      </main>
    );
  }

  const item = itemQuery.data;
  const variants = variantsQuery.data?.data ?? [];
  const sizeChartValues =
    sizeChartsQuery.data?.data.find((chart) => chart.id === item.size_chart)?.values ?? [];
  const showCost = variants.some((v) => v.avg_cost !== undefined);

  const columns: readonly ReportColumn[] = [
    { header: t('catalog.detail.sku') },
    { header: t('catalog.detail.size') },
    { header: t('catalog.detail.colour') },
    { header: t('catalog.detail.barcode') },
    { header: t('catalog.detail.mrp'), className: 'text-right' },
    ...(showCost ? [{ header: t('catalog.detail.avgCost'), className: 'text-right' }] : []),
  ];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <Card
        title={`${item.name} (${item.code})`}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link to={`/catalog/items/${item.id}/edit`}>{t('catalog.detail.edit')}</Link>
          </Button>
        }
      >
        <div className="flex items-start gap-3">
          <ItemImage imageUrl={item.image_url} alt={item.name} className="h-20 w-20" />
          <dl className="grid flex-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('catalog.detail.nameNp')}</dt>
              <dd>{item.name_np ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('catalog.detail.unit')}</dt>
              <dd>{item.unit}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('catalog.detail.vatApplicable')}</dt>
              <dd>{item.is_vat_applicable ? t('catalog.detail.yes') : t('catalog.detail.no')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('catalog.detail.reorderLevel')}</dt>
              <dd>{item.reorder_level ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card title={t('catalog.detail.variantsTitle', { count: variants.length })}>
        {variantsQuery.isFetching ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : (
          <ReportTable
            columns={columns}
            rows={variants}
            rowKey={(variant) => variant.id}
            empty={t('catalog.detail.emptyVariants')}
            renderCells={(variant) => (
              <>
                <TableCell className="font-medium">{variant.sku}</TableCell>
                <TableCell>{variant.size}</TableCell>
                <TableCell>{variant.color}</TableCell>
                <TableCell className="text-muted-foreground">{variant.barcode ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNpr(variant.mrp)}
                </TableCell>
                {showCost ? (
                  <TableCell className="text-right tabular-nums">
                    {variant.avg_cost !== undefined ? formatNpr(variant.avg_cost) : '—'}
                  </TableCell>
                ) : null}
              </>
            )}
            renderCard={(variant) => (
              <div className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{variant.sku}</p>
                  <p className="text-muted-foreground">
                    {variant.size} / {variant.color} ·{' '}
                    {variant.barcode ?? t('catalog.detail.noBarcode')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium tabular-nums">{formatNpr(variant.mrp)}</p>
                  {showCost && variant.avg_cost !== undefined ? (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t('catalog.detail.costAmount', { amount: formatNpr(variant.avg_cost) })}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          />
        )}
      </Card>

      <Card title={t('catalog.detail.matrixTitle')}>
        <VariantMatrix
          itemId={item.id}
          sizeChartValues={sizeChartValues}
          existingVariants={variants}
          onCreated={() =>
            void queryClient.invalidateQueries({ queryKey: ['catalog', 'variants', id] })
          }
        />
      </Card>
    </main>
  );
}
