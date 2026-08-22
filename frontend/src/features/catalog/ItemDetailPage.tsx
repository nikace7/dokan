import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { TableCell } from '@/components/ui/table';
import {
  deactivateItem,
  getItem,
  listBrands,
  listCategories,
  listSizeCharts,
  listVariants,
} from '@/features/catalog/api';
import type { Item, ItemVariant } from '@/features/catalog/api';
import { ItemImage } from '@/features/catalog/ui';
import { VariantMatrix } from '@/features/catalog/VariantMatrix';
import { ReportTable } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { formatNpr, useMoneyDisplay } from '@/lib/money';

/** Item.gender codes → the shared genderOptions i18n keys. */
const GENDER_LABEL_KEY = {
  M: 'men',
  F: 'women',
  U: 'unisex',
  KIDS: 'kids',
} as const;

/** MRP spread across the active variants, computed client-side (detail has no annotation). */
function mrpRange(variants: ItemVariant[]): { min: string; max: string } | null {
  const prices = variants.map((v) => v.mrp).filter((m): m is string => m !== null);
  if (prices.length === 0) {
    return null;
  }
  const sorted = [...prices].sort((a, b) => Number(a) - Number(b));
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

/**
 * Item detail as a storefront product page: photo card with tap-to-zoom on
 * the left, facts + management actions on the right, then the variant list
 * and the size × colour matrix below.
 */
export function ItemDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useMoneyDisplay();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

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
  const categoriesQuery = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: listCategories,
    staleTime: 5 * 60_000,
  });
  const brandsQuery = useQuery({
    queryKey: ['catalog', 'brands'],
    queryFn: listBrands,
    staleTime: 5 * 60_000,
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateItem,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'items'] });
      navigate('/catalog');
    },
  });

  const variants = useMemo(() => variantsQuery.data?.data ?? [], [variantsQuery.data]);

  if (itemQuery.isPending) {
    return (
      <main className="mx-auto max-w-5xl p-4">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </main>
    );
  }
  if (itemQuery.isError || !itemQuery.data) {
    return (
      <main className="mx-auto max-w-5xl p-4">
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {itemQuery.error instanceof Error
            ? itemQuery.error.message
            : t('catalog.detail.notFound')}
        </p>
        <Link className="mt-2 inline-block text-primary hover:underline" to="/catalog">
          {t('catalog.detail.back')}
        </Link>
      </main>
    );
  }

  const item: Item = itemQuery.data;
  const sizeChartValues =
    sizeChartsQuery.data?.data.find((chart) => chart.id === item.size_chart)?.values ?? [];
  const categoryName = categoriesQuery.data?.data.find((c) => c.id === item.category)?.name ?? null;
  const brandName = brandsQuery.data?.data.find((b) => b.id === item.brand)?.name ?? null;
  const range = mrpRange(variants);
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
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        {/* Photo card — tap to preview full-screen. (A plain div, not Card:
            Card forces an inner p-4 the edge-to-edge photo must not have.) */}
        <div className="self-start overflow-hidden rounded-lg border bg-card shadow-sm">
          {item.image_url ? (
            <button
              type="button"
              aria-label={t('catalog.photo.preview')}
              onClick={() => setPreviewOpen(true)}
              className="group relative block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ItemImage
                imageUrl={item.image_url}
                alt={item.name}
                className="aspect-square h-auto w-full rounded-none border-0"
              />
              <span className="absolute bottom-2 right-2 rounded-full bg-background/85 p-2 text-foreground shadow-sm backdrop-blur transition-transform group-hover:scale-110">
                <ZoomIn className="h-4 w-4" aria-hidden />
              </span>
            </button>
          ) : (
            <ItemImage
              imageUrl={null}
              alt={item.name}
              className="aspect-square h-auto w-full rounded-none border-0"
            />
          )}
        </div>

        <Card
          title={`${item.name} (${item.code})`}
          actions={
            <div className="flex items-center gap-2">
              {item.is_active ? (
                confirmDeactivate ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deactivateMutation.isPending}
                      onClick={() => setConfirmDeactivate(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deactivateMutation.isPending}
                      onClick={() => deactivateMutation.mutate(item.id)}
                    >
                      {t('catalog.detail.deactivateConfirm')}
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDeactivate(true)}>
                    {t('catalog.items.deactivate')}
                  </Button>
                )
              ) : null}
              <Button asChild variant="secondary" size="sm">
                <Link to={`/catalog/items/${item.id}/edit`}>{t('catalog.detail.edit')}</Link>
              </Button>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {item.name_np ? <Badge variant="secondary">{item.name_np}</Badge> : null}
            {categoryName ? <Badge variant="outline">{categoryName}</Badge> : null}
            {brandName ? <Badge variant="outline">{brandName}</Badge> : null}
            {item.gender ? (
              <Badge variant="outline">
                {t(`catalog.form.genderOptions.${GENDER_LABEL_KEY[item.gender]}`)}
              </Badge>
            ) : null}
            <Badge variant={item.is_active ? 'success' : 'secondary'}>
              {item.is_active ? t('catalog.items.active') : t('catalog.items.inactive')}
            </Badge>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
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
            <div>
              <dt className="text-muted-foreground">{t('catalog.detail.mrpRange')}</dt>
              <dd className="font-medium tabular-nums">
                {range
                  ? range.min === range.max
                    ? formatNpr(range.min)
                    : `${formatNpr(range.min)} – ${formatNpr(range.max)}`
                  : '—'}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <ImageLightbox
        imageUrl={previewOpen ? item.image_url : null}
        alt={item.name}
        onClose={() => setPreviewOpen(false)}
      />

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
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    {variant.color_hex ? (
                      <span
                        aria-hidden
                        className="h-3.5 w-3.5 rounded-full border border-border"
                        style={{ backgroundColor: variant.color_hex }}
                      />
                    ) : null}
                    {variant.color}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{variant.barcode ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {variant.mrp !== null ? formatNpr(variant.mrp) : '—'}
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
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    {variant.color_hex ? (
                      <span
                        aria-hidden
                        className="h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: variant.color_hex }}
                      />
                    ) : null}
                    {variant.size} / {variant.color} ·{' '}
                    {variant.barcode ?? t('catalog.detail.noBarcode')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium tabular-nums">
                    {variant.mrp !== null ? formatNpr(variant.mrp) : '—'}
                  </p>
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
