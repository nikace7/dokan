import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import { searchVariantsForSale } from '@/features/billing/api';
import type { VariantForSale } from '@/features/billing/api';
import { SaleItemTile } from '@/features/billing/SaleItemTile';
import type { SimpleLine } from '@/features/billing/simpleSaleModel';

/** How many in-stock tiles the grid shows (first page, as the API orders them). */
const TILE_COUNT = 8;

interface SimpleSaleQuickPickProps {
  branchId: string;
  /** The bill so far, to show on each tile how many are on it. */
  lines: SimpleLine[];
  onPick: (variant: VariantForSale) => void;
}

/**
 * Tappable grid of in-stock variants on the simple-sale screen — the
 * POS "item grid" — so an empty bill is useful instead of a blank page.
 * Shares the picker dialog's query key, so a later search opens on warm
 * cache. Load failures render nothing: the Add-item dialog carries the
 * error/empty messaging.
 */
export function SimpleSaleQuickPick({ branchId, lines, onPick }: SimpleSaleQuickPickProps) {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['catalog', 'for-sale', branchId, ''],
    queryFn: () => searchVariantsForSale(branchId, ''),
    staleTime: 30_000,
  });

  if (query.isError) {
    return null;
  }

  const rows = (query.data?.data ?? []).slice(0, TILE_COUNT);

  return (
    <section aria-label={t('simpleSale.quickPick.title')} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {t('simpleSale.quickPick.title')}
      </h2>
      {query.isPending ? (
        <div
          role="status"
          aria-label={t('simpleSale.picker.loadingAria')}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
        >
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="flex flex-col gap-2 rounded-md border border-border p-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t('simpleSale.quickPick.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((row) => (
            <SaleItemTile
              key={row.id}
              variant={row}
              onBill={lines.find((line) => line.variant.id === row.id)?.qty}
              onPick={onPick}
            />
          ))}
        </div>
      )}
    </section>
  );
}
