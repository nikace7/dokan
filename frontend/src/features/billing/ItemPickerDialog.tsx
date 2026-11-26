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
import { SaleItemTile } from '@/features/billing/SaleItemTile';
import { useDebounced } from '@/lib/useDebounced';

interface ItemPickerDialogProps {
  open: boolean;
  branchId: string | null;
  /** The rate the bill is at: rows come priced at it. */
  rateTypeId: string | null;
  /** Text the search box starts with, e.g. a name typed at the scan box. */
  initialSearch?: string;
  onOpenChange: (open: boolean) => void;
  onPick: (variant: VariantForSale) => void;
}

/**
 * Searchable in-stock item picker for the simple sale, rendered as a grid
 * of tiles. Only rows with stock on hand come back from
 * `GET /catalog/variants/for-sale`; picking a cell hands the whole variant
 * (with its price bounds) to the caller.
 */
export function ItemPickerDialog({
  open,
  branchId,
  rateTypeId,
  initialSearch = '',
  onOpenChange,
  onPick,
}: ItemPickerDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const term = useDebounced(search);

  // Reset the search every time the picker is opened for a fresh line.
  useEffect(() => {
    if (open) setSearch(initialSearch);
  }, [open, initialSearch]);

  const query = useQuery({
    queryKey: ['catalog', 'for-sale', branchId, rateTypeId, term],
    queryFn: () => searchVariantsForSale(branchId as string, term, rateTypeId),
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
                <SaleItemTile key={row.id} variant={row} onPick={onPick} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
