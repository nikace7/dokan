import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/useAuth';
import { fetchLowStock } from '@/features/reports/api';
import type { LowStockRow } from '@/features/reports/api';
import { hasPermission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/**
 * Horizontal preview of the first low-stock page, shown under the dashboard
 * stat tiles when the summary reports items at/below reorder level. The
 * dashboard includes the low-stock count with just `stock.view`, but the
 * report endpoint requires `report.stock`, so the strip self-gates: no
 * permission, no fetch, no render. Every chip links to the full stock report.
 */
export function LowStockStrip({ count }: { count: number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canViewStockReport = hasPermission(user, 'report.stock');
  const lowStock = useQuery({
    queryKey: ['reports', 'low-stock', 'dashboard-preview'],
    queryFn: () => fetchLowStock(1),
    enabled: count > 0 && canViewStockReport,
  });

  if (count <= 0 || !canViewStockReport) {
    return null;
  }

  return (
    <section aria-label={t('dashboard.lowStock')}>
      <p className="mb-2 text-sm font-medium text-muted-foreground">
        {t('dashboard.lowStock')} · {t('dashboard.itemsCount', { count })}
      </p>
      {lowStock.isPending ? (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-44 shrink-0 rounded-xl" />
          ))}
        </div>
      ) : lowStock.data ? (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {lowStock.data.data.map((row) => (
            <li key={row.variant_id} className="shrink-0">
              <LowStockChip row={row} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function LowStockChip({ row }: { row: LowStockRow }) {
  const { t } = useTranslation();
  const isOut = Number(row.qty_on_hand) <= 0;
  return (
    <Link
      to="/reports/stock"
      className={cn(
        'flex w-44 flex-col gap-1 rounded-xl border px-3 py-2 transition-shadow',
        'hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isOut ? 'border-destructive/50 bg-destructive/10' : 'border-warning/50 bg-warning/10',
      )}
    >
      <span className="font-mono text-xs text-muted-foreground">{row.sku}</span>
      <span className="truncate text-sm font-medium text-foreground">{row.item_name}</span>
      <span className="flex items-center gap-1.5 text-xs">
        <Badge variant={isOut ? 'destructive' : 'warning'}>
          {t('reports.stock.qtyLeft', { count: row.qty_on_hand })}
        </Badge>
        <span className="truncate text-muted-foreground">
          {t('reports.stock.reorderAt', { level: row.reorder_level })}
        </span>
      </span>
    </Link>
  );
}
