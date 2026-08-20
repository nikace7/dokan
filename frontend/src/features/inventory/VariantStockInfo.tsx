import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { listLevels } from '@/features/inventory/api';
import { formatNpr } from '@/lib/money';

interface VariantStockInfoProps {
  variant: PickedVariant;
  branchId: string | null;
}

/** Trim `8.000` → `8`, keep real fractions like `2.5`. */
function qtyDisplay(raw: string): string {
  return raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * Catalog context inside the stock dialogs: the variant's price bounds and
 * how many pieces the active branch already holds, so entry mistakes (wrong
 * variant, double counting) surface before anything is posted.
 */
export function VariantStockInfo({ variant, branchId }: VariantStockInfoProps) {
  const { t } = useTranslation();
  const levelQuery = useQuery({
    queryKey: ['inventory', 'levels', 'variant', branchId, variant.id],
    queryFn: () => listLevels({ branch: branchId ?? undefined, variant: variant.id }),
    enabled: branchId !== null,
    staleTime: 30_000,
  });

  const qty = levelQuery.data?.data[0]?.qty_on_hand ?? null;
  const range =
    variant.minPrice !== null || variant.maxPrice !== null
      ? `${variant.minPrice !== null ? formatNpr(variant.minPrice) : '—'} – ${
          variant.maxPrice !== null ? formatNpr(variant.maxPrice) : '—'
        }`
      : null;

  return (
    <dl className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
      <div>
        <dt className="text-muted-foreground">{t('inventory.variantInfo.mrp')}</dt>
        <dd className="font-medium tabular-nums">{formatNpr(variant.mrp)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('inventory.variantInfo.range')}</dt>
        <dd className="font-medium tabular-nums">{range ?? t('inventory.variantInfo.noRange')}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('inventory.variantInfo.onHand')}</dt>
        <dd className="font-medium tabular-nums">
          {levelQuery.isFetching ? '…' : qty === null ? '0' : qtyDisplay(qty)}
        </dd>
      </div>
    </dl>
  );
}
