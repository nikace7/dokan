import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/Input';
import { listVariants, searchItems } from '@/features/catalog/api';
import type { Item, ItemVariant } from '@/features/catalog/api';
import { formatNpr, useMoneyDisplay } from '@/lib/money';

export interface PickedVariant {
  id: string;
  sku: string;
  size: string;
  color: string;
  /** Null when the variant has no MRP set. */
  mrp: string | null;
  itemName: string;
  /** Variant min/max SP, falling back to the item's range; null when unset. */
  minPrice: string | null;
  maxPrice: string | null;
}

/** Map an item + variant row to the picked shape (price range falls back to the item's). */
function toPicked(item: Item, variant: ItemVariant): PickedVariant {
  return {
    id: variant.id,
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    mrp: variant.mrp,
    itemName: item.name,
    minPrice: variant.min_selling_price ?? item.min_selling_price ?? null,
    maxPrice: variant.max_selling_price ?? item.max_selling_price ?? null,
  };
}

interface VariantPickerProps {
  /** Fires once a concrete variant is chosen. */
  onPick: (variant: PickedVariant) => void;
  placeholder?: string;
}

/**
 * Two-step variant picker: search items by name/code, then pick one of the
 * item's size × colour variants. Uses only real endpoints —
 * `GET /catalog/items?search=` then `GET /catalog/variants?item=`
 * (the variant list has no search param).
 */
export function VariantPicker({ onPick, placeholder }: VariantPickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [item, setItem] = useState<Item | null>(null);
  useMoneyDisplay();

  const itemsQuery = useQuery({
    queryKey: ['catalog', 'items', 'picker', search],
    queryFn: () => searchItems(search),
    enabled: !item && search.trim().length >= 2,
    staleTime: 30_000,
  });

  const variantsQuery = useQuery({
    queryKey: ['catalog', 'variants', item?.id],
    queryFn: () => listVariants(item?.id ?? ''),
    enabled: item !== null,
    staleTime: 30_000,
  });

  const variants = variantsQuery.data?.data;

  // Single-variant items skip the second tap: the only choice is picked
  // automatically once the variant list loads.
  useEffect(() => {
    if (item && variants && variants.length === 1) {
      onPick(toPicked(item, variants[0]));
      setItem(null);
      setSearch('');
    }
  }, [item, variants, onPick]);

  if (item) {
    const variantRows = variants ?? [];
    return (
      <div className="rounded-md border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-2 text-sm">
          <span className="font-medium">
            {item.name} <span className="text-muted-foreground">({item.code})</span>
          </span>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setItem(null);
              setSearch('');
            }}
          >
            {t('catalog.picker.change')}
          </button>
        </div>
        {variantsQuery.isFetching ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t('catalog.picker.loading')}</p>
        ) : null}
        {variantsQuery.data && variantRows.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t('catalog.picker.empty')}</p>
        ) : null}
        <ul className="max-h-48 divide-y divide-border overflow-y-auto">
          {variantRows.map((variant: ItemVariant) => (
            <li key={variant.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onPick(toPicked(item, variant));
                  setItem(null);
                  setSearch('');
                }}
              >
                <span>
                  {variant.size} / {variant.color}{' '}
                  <span className="text-xs text-muted-foreground">{variant.sku}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {variant.mrp !== null ? formatNpr(variant.mrp) : '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <Input
        aria-label={t('catalog.items.searchAria')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder ?? t('catalog.picker.searchPlaceholder')}
        autoComplete="off"
      />
      {itemsQuery.isFetching ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('billing.searching')}</p>
      ) : null}
      {itemsQuery.data && itemsQuery.data.data.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('catalog.picker.noMatch')}</p>
      ) : null}
      {itemsQuery.data && itemsQuery.data.data.length > 0 ? (
        <ul className="mt-1 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border bg-card">
          {itemsQuery.data.data.map((found) => (
            <li key={found.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => setItem(found)}
              >
                <span className="font-medium">{found.name}</span>
                <span className="text-muted-foreground">{found.code}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
