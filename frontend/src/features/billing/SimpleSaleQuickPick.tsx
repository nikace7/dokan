import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import { searchVariantsForSale } from '@/features/billing/api';
import type { VariantForSale } from '@/features/billing/api';
import { ItemImage } from '@/features/catalog/ui';
import { formatNpr, useMoneyDisplay } from '@/lib/money';
import { cn } from '@/lib/utils';

/** How many in-stock tiles the grid shows (first page, as the API orders them). */
const TILE_COUNT = 8;

interface SimpleSaleQuickPickProps {
  branchId: string;
  onPick: (variant: VariantForSale) => void;
}

/**
 * Tappable photo grid of in-stock variants on the simple-sale screen — the
 * POS "item grid" — so an empty bill is useful instead of a blank page.
 * Shares the picker dialog's query key, so a later search opens on warm
 * cache. Load failures render nothing: the Add-item dialog carries the
 * error/empty messaging.
 */
export function SimpleSaleQuickPick({ branchId, onPick }: SimpleSaleQuickPickProps) {
  const { t } = useTranslation();
  useMoneyDisplay();

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
              <Skeleton className="aspect-square h-auto w-full" />
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
            <button
              key={row.id}
              type="button"
              className={cn(
                'flex flex-col gap-1 rounded-md border border-border bg-card p-2 text-left',
                'transition-colors hover:bg-accent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              onClick={() => onPick(row)}
            >
              <ItemImage
                imageUrl={row.image_url}
                alt={row.item_name}
                className="aspect-square h-auto w-full"
              />
              <span className="block truncate text-sm font-medium">
                {row.item_name}
                <span className="text-muted-foreground">
                  {' '}
                  — {row.size} / {row.color}
                </span>
              </span>
              {row.mrp ? (
                <span className="text-sm font-bold tabular-nums">{formatNpr(row.mrp)}</span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {t('common.stock', { qty: row.qty_on_hand })}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
