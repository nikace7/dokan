import { useQuery } from '@tanstack/react-query';
import { Banknote, Clock3, Package, PackageCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatTile } from '@/components/ui/StatTile';
import { getStockSummary } from '@/features/inventory/api';
import { toPaisa } from '@/lib/money';

/** Current tenant-wide stock totals, independent of table search and pagination. */
export function StockSummary() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: getStockSummary,
  });

  if (query.isError) {
    return (
      <p role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        {query.error instanceof Error
          ? query.error.message
          : t('inventory.stock.summary.loadError')}
      </p>
    );
  }

  const totals = query.data;
  const showValue = totals?.stock_value !== undefined;
  return (
    <section
      className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
      aria-label={t('inventory.stock.summary.label')}
    >
      <StatTile
        label={t('inventory.stock.summary.onHand')}
        value={totals ? formatQuantity(totals.total_qty_on_hand) : undefined}
        icon={Package}
        tint="blue"
        isLoading={query.isPending}
      />
      <StatTile
        label={t('inventory.stock.summary.reserved')}
        value={totals ? formatQuantity(totals.total_qty_reserved) : undefined}
        icon={Clock3}
        tint="amber"
        isLoading={query.isPending}
      />
      <StatTile
        label={t('inventory.stock.summary.available')}
        value={totals ? formatQuantity(totals.total_qty_available) : undefined}
        icon={PackageCheck}
        tint="green"
        isLoading={query.isPending}
      />
      {showValue ? (
        <StatTile
          label={t('inventory.stock.summary.value')}
          valuePaisa={toPaisa(totals.stock_value ?? '0')}
          icon={Banknote}
          tint="violet"
        />
      ) : null}
    </section>
  );
}

function formatQuantity(value: string): string {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return value;
  return quantity.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
