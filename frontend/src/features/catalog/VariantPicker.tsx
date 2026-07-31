import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listVariants, searchItems } from '@/features/catalog/api';
import type { Item, ItemVariant } from '@/features/catalog/api';
import { formatNpr } from '@/lib/money';

export interface PickedVariant {
  id: string;
  sku: string;
  size: string;
  color: string;
  mrp: string;
  itemName: string;
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
  const [search, setSearch] = useState('');
  const [item, setItem] = useState<Item | null>(null);

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

  if (item) {
    const variants = variantsQuery.data?.data ?? [];
    return (
      <div className="rounded-md border border-slate-300">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="font-medium text-slate-900">
            {item.name} <span className="text-slate-500">({item.code})</span>
          </span>
          <button
            type="button"
            className="text-blue-700 hover:underline"
            onClick={() => {
              setItem(null);
              setSearch('');
            }}
          >
            Change
          </button>
        </div>
        {variantsQuery.isFetching ? (
          <p className="px-3 py-2 text-sm text-slate-500">Loading variants…</p>
        ) : null}
        {variantsQuery.data && variants.length === 0 ? (
          <p className="px-3 py-2 text-sm text-slate-500">No active variants for this item.</p>
        ) : null}
        <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto">
          {variants.map((variant: ItemVariant) => (
            <li key={variant.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-blue-50"
                onClick={() => {
                  onPick({
                    id: variant.id,
                    sku: variant.sku,
                    size: variant.size,
                    color: variant.color,
                    mrp: variant.mrp,
                    itemName: item.name,
                  });
                  setItem(null);
                  setSearch('');
                }}
              >
                <span>
                  {variant.size} / {variant.color}{' '}
                  <span className="text-xs text-slate-500">{variant.sku}</span>
                </span>
                <span className="text-slate-600">{formatNpr(variant.mrp)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <input
        aria-label="Search items"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder ?? 'Search item by name or code…'}
        autoComplete="off"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {itemsQuery.isFetching ? <p className="mt-1 text-xs text-slate-500">Searching…</p> : null}
      {itemsQuery.data && itemsQuery.data.data.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">No items match.</p>
      ) : null}
      {itemsQuery.data && itemsQuery.data.data.length > 0 ? (
        <ul className="mt-1 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {itemsQuery.data.data.map((found) => (
            <li key={found.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => setItem(found)}
              >
                <span className="font-medium text-slate-900">{found.name}</span>
                <span className="text-slate-500">{found.code}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
