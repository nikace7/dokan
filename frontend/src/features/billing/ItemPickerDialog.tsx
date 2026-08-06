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
import { formatNpr } from '@/lib/money';

const DEBOUNCE_MS = 300;

interface ItemPickerDialogProps {
  open: boolean;
  branchId: string | null;
  onOpenChange: (open: boolean) => void;
  onPick: (variant: VariantForSale) => void;
}

/**
 * Searchable in-stock item picker for the simple sale. Only rows with
 * stock on hand come back from `GET /catalog/variants/for-sale`; picking a
 * row hands the whole variant (with its price bounds) to the caller.
 */
export function ItemPickerDialog({ open, branchId, onOpenChange, onPick }: ItemPickerDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

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
            <div role="status" aria-label={t('simpleSale.picker.loadingAria')} className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
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
            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onPick(row)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {row.item_name}
                        <span className="text-muted-foreground">
                          {' '}
                          — {row.size} / {row.color}
                        </span>
                      </span>
                      <span className="block text-xs text-muted-foreground">{row.sku}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      {row.mrp ? (
                        <span className="block text-sm font-medium">{formatNpr(row.mrp)}</span>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">
                        {t('common.stock', { qty: row.qty_on_hand })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
