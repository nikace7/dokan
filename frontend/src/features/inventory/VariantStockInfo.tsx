import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { ItemImage } from '@/features/catalog/ui';
import { listLevels } from '@/features/inventory/api';
import { formatNpr, useMoneyDisplay } from '@/lib/money';

interface VariantStockInfoProps {
  variant: PickedVariant;
  branchId: string | null;
}

/** Trim `8.000` → `8`, keep real fractions like `2.5`. */
function qtyDisplay(raw: string): string {
  return raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * Variant stock card: photo, name/SKU, price bounds, and how many pieces the
 * branch already holds. Shown inside the stock dialogs (entry mistakes like a
 * wrong variant or double counting surface before anything is posted) and from
 * the stock-levels table, where a row opens it as a dialog.
 */
export function VariantStockInfo({ variant, branchId }: VariantStockInfoProps) {
  const { t } = useTranslation();
  useMoneyDisplay();
  const levelQuery = useQuery({
    queryKey: ['inventory', 'levels', 'variant', branchId, variant.id],
    queryFn: () => listLevels({ branch: branchId ?? undefined, variant: variant.id }),
    enabled: branchId !== null,
    staleTime: 30_000,
  });

  const level = levelQuery.data?.data[0];
  const qty = level?.qty_on_hand ?? null;
  const range =
    variant.minPrice !== null || variant.maxPrice !== null
      ? `${variant.minPrice !== null ? formatNpr(variant.minPrice) : '—'} – ${
          variant.maxPrice !== null ? formatNpr(variant.maxPrice) : '—'
        }`
      : null;

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="mb-2 flex items-center gap-3">
        <ItemImage imageUrl={level?.image_url} alt={variant.itemName} className="h-14 w-14" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{variant.itemName}</p>
          <p className="text-xs text-muted-foreground">{variant.sku}</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">{t('inventory.variantInfo.mrp')}</dt>
          <dd className="font-medium tabular-nums">
            {variant.mrp !== null ? formatNpr(variant.mrp) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('inventory.variantInfo.range')}</dt>
          <dd className="font-medium tabular-nums">
            {range ?? t('inventory.variantInfo.noRange')}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('inventory.variantInfo.onHand')}</dt>
          <dd className="font-medium tabular-nums">
            {levelQuery.isFetching ? '…' : qty === null ? '0' : qtyDisplay(qty)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
