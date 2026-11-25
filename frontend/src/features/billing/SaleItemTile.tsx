import { useTranslation } from 'react-i18next';

import type { VariantForSale } from '@/features/billing/api';
import { ItemImage } from '@/features/catalog/ui';
import { formatNpr, useMoneyDisplay } from '@/lib/money';
import { cn } from '@/lib/utils';

interface SaleItemTileProps {
  variant: VariantForSale;
  /** Quantity already on the bill, shown on the tile. */
  onBill?: string;
  onPick: (variant: VariantForSale) => void;
}

/** One tappable item of the simple sale: small photo, if any, beside the text. */
export function SaleItemTile({ variant, onBill, onPick }: SaleItemTileProps) {
  const { t } = useTranslation();
  useMoneyDisplay();

  return (
    <button
      type="button"
      className={cn(
        'flex items-start gap-2 rounded-md border border-border bg-card p-2 text-left',
        'transition-colors hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        onBill && 'border-primary',
      )}
      onClick={() => onPick(variant)}
    >
      {variant.image_url ? (
        <ItemImage imageUrl={variant.image_url} alt={variant.item_name} className="h-11 w-11" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium leading-tight">
          {variant.item_name}
          <span className="text-muted-foreground">
            {' '}
            — {variant.size} / {variant.color}
          </span>
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          {variant.mrp ? (
            <span className="text-sm font-bold tabular-nums">{formatNpr(variant.mrp)}</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {t('common.stock', { qty: variant.qty_on_hand })}
          </span>
        </span>
      </span>
      {onBill ? (
        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
          × {onBill}
        </span>
      ) : null}
    </button>
  );
}
