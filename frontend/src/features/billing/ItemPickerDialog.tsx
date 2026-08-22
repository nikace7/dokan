import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/skeleton';
import { searchVariantsForSale } from '@/features/billing/api';
import type { VariantForSale } from '@/features/billing/api';
import { ItemImage } from '@/features/catalog/ui';
import { formatNpr, useMoneyDisplay } from '@/lib/money';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 300;

interface ItemPickerDialogProps {
  open: boolean;
  branchId: string | null;
  onOpenChange: (open: boolean) => void;
  onPick: (variant: VariantForSale) => void;
}

/**
 * Searchable in-stock item picker for the simple sale, rendered as a photo
 * grid. Only rows with stock on hand come back from
 * `GET /catalog/variants/for-sale`; picking a cell hands the whole variant
 * (with its price bounds) to the caller.
 */
export function ItemPickerDialog({ open, branchId, onOpenChange, onPick }: ItemPickerDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useMoneyDisplay();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset the search every time the picker is opened for a fresh line.
  useEffect(() => {
    if (open) {
      setSearch('');
      setDebounced('');
    }
  }, [open]);

  const query = useQuery({
    queryKey: ['catalog', 'for-sale', branchId, debounced],
    queryFn: () => searchVariantsForSale(branchId as string, debounced),
    enabled: open && branchId !== null,
    staleTime: 30_000,
  });

  const rows = query.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{t('simpleSale.picker.title')}</DialogTitle>
          <DialogDescription>{t('simpleSale.picker.subtitle')}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('simpleSale.picker.searchPlaceholder')}
          aria-label={t('simpleSale.picker.searchAria')}
        />
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {query.isPending ? (
            <div
              role="status"
              aria-label={t('simpleSale.picker.loadingAria')}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="flex flex-col gap-2 rounded-md border border-border p-2">
                  <Skeleton className="aspect-square h-auto w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : query.isError ? (
            <p role="alert" className="py-6 text-center text-sm text-destructive">
              {t('simpleSale.picker.loadError')}
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('simpleSale.picker.empty')}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={cn(
                    'flex flex-col gap-1 rounded-md border border-border p-2 text-left',
                    'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
