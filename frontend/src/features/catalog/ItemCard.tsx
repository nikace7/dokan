import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import type { Item } from '@/features/catalog/api';
import { ItemImage } from '@/features/catalog/ui';
import { formatNpr, useMoneyDisplay } from '@/lib/money';

interface ItemCardProps {
  item: Item;
  /** Resolved category name (the API sends only the id); null when unset. */
  categoryName: string | null;
}

/**
 * Storefront-style catalog card: square photo with a hover zoom, name, code ·
 * category, the active-variant MRP range, and a variant count. The whole card
 * links to the item detail; management actions (edit/deactivate) live there.
 */
export function ItemCard({ item, categoryName }: ItemCardProps) {
  const { t } = useTranslation();
  useMoneyDisplay();

  const min = item.mrp_min ?? null;
  const max = item.mrp_max ?? null;
  const priceLabel =
    min !== null && max !== null
      ? min === max
        ? formatNpr(min)
        : `${formatNpr(min)} – ${formatNpr(max)}`
      : '—';

  return (
    <Link
      to={`/catalog/items/${item.id}`}
      aria-label={`${item.name} (${item.code})`}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card shadow-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative">
        <ItemImage
          imageUrl={item.image_url}
          alt={item.name}
          className="aspect-square h-auto w-full rounded-none border-0 transition-transform duration-300 group-hover:scale-105"
        />
        {!item.is_active ? (
          <Badge variant="secondary" className="absolute left-2 top-2 shadow-sm">
            {t('catalog.items.inactive')}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <p className="truncate text-sm font-medium">
          {item.name}
          {item.name_np ? <span className="text-muted-foreground"> · {item.name_np}</span> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {item.code}
          {categoryName ? ` · ${categoryName}` : ''}
        </p>
        <p className="mt-1 text-sm font-semibold tabular-nums">{priceLabel}</p>
        <p className="text-xs text-muted-foreground">
          {t('catalog.items.variantsCount', { count: item.variants_count ?? 0 })}
        </p>
      </div>
    </Link>
  );
}
