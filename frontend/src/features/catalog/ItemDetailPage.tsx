import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getItem, listSizeCharts, listVariants } from '@/features/catalog/api';
import { VariantMatrix } from '@/features/catalog/VariantMatrix';
import { formatNpr } from '@/lib/money';

/**
 * Item detail: summary, existing variants, and the size × colour matrix
 * entry — the natural next step after creating an item.
 */
export function ItemDetailPage() {
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
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }
  if (itemQuery.isError || !itemQuery.data) {
    return (
      <main className="mx-auto max-w-4xl p-4">
        <p role="alert" className="text-sm text-red-600">
          {itemQuery.error instanceof Error ? itemQuery.error.message : 'Item not found.'}
        </p>
        <Link className="mt-2 inline-block text-blue-700 hover:underline" to="/catalog">
          Back to items
        </Link>
      </main>
    );
  }

  const item = itemQuery.data;
  const variants = variantsQuery.data?.data ?? [];
  const sizeChartValues =
    sizeChartsQuery.data?.data.find((chart) => chart.id === item.size_chart)?.values ?? [];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <Card
        title={`${item.name} (${item.code})`}
        actions={
          <Link to={`/catalog/items/${item.id}/edit`}>
            <Button variant="secondary" size="sm">
              Edit item
            </Button>
          </Link>
        }
      >
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Name (Nepali)</dt>
            <dd>{item.name_np ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Unit</dt>
            <dd>{item.unit}</dd>
          </div>
          <div>
            <dt className="text-slate-500">VAT applicable</dt>
            <dd>{item.is_vat_applicable ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Reorder level</dt>
            <dd>{item.reorder_level ?? '—'}</dd>
          </div>
        </dl>
      </Card>

      <Card title={`Variants (${variants.length})`}>
        {variantsQuery.isFetching ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : variants.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            No variants yet — use the matrix below to create the whole size × colour grid in one
            go.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2 font-medium">SKU</th>
                <th className="py-2 pr-2 font-medium">Size</th>
                <th className="py-2 pr-2 font-medium">Colour</th>
                <th className="py-2 pr-2 font-medium">Barcode</th>
                <th className="py-2 pr-2 text-right font-medium">MRP</th>
                {variants.some((v) => v.avg_cost !== undefined) ? (
                  <th className="py-2 text-right font-medium">Avg cost</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id} className="border-b border-slate-100">
                  <td className="py-2 pr-2 font-medium">{variant.sku}</td>
                  <td className="py-2 pr-2">{variant.size}</td>
                  <td className="py-2 pr-2">{variant.color}</td>
                  <td className="py-2 pr-2 text-slate-500">{variant.barcode ?? '—'}</td>
                  <td className="py-2 pr-2 text-right">{formatNpr(variant.mrp)}</td>
                  {variants.some((v) => v.avg_cost !== undefined) ? (
                    <td className="py-2 text-right">
                      {variant.avg_cost !== undefined ? formatNpr(variant.avg_cost) : '—'}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Add variants — size × colour matrix">
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
