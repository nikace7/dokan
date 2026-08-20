import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/Input';
import { postOpeningStock } from '@/features/inventory/api';
import { VariantStockInfo } from '@/features/inventory/VariantStockInfo';
import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { VariantPicker } from '@/features/catalog/VariantPicker';
import { ApiError } from '@/lib/api/client';
import { useWorkspace } from '@/features/settings/useWorkspace';

interface OpeningStockDialogProps {
  onClose: () => void;
  onPosted: () => void;
}

/**
 * "Add opening stock" dialog. Writes one OPENING ledger movement — the
 * only way stock enters the system besides purchasing (invariant 1).
 */
export function OpeningStockDialog({ onClose, onPosted }: OpeningStockDialogProps) {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const [variant, setVariant] = useState<PickedVariant | null>(null);
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: postOpeningStock,
    onSuccess: onPosted,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('inventory.opening.postError')),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!variant) {
      setError(t('inventory.operation.pickVariant'));
      return;
    }
    if (!workspace.branchId) {
      setError(t('inventory.operation.selectBranch'));
      return;
    }
    mutation.mutate({
      branch: workspace.branchId,
      variant: variant.id,
      qty: qty.trim(),
      unit_cost: unitCost.trim(),
      ...(note.trim() !== '' ? { note: note.trim() } : {}),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent aria-label={t('inventory.opening.title')} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('inventory.opening.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {variant ? (
            <>
              <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <span className="font-medium">
                  {variant.itemName} — {variant.size} / {variant.color}
                  <span className="ml-1 text-xs text-muted-foreground">{variant.sku}</span>
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setVariant(null)}
                >
                  {t('catalog.picker.change')}
                </button>
              </div>
              <VariantStockInfo variant={variant} branchId={workspace.branchId} />
            </>
          ) : (
            <VariantPicker onPick={setVariant} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('inventory.opening.quantity')}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              required
              placeholder="20"
            />
            <Input
              label={t('inventory.opening.unitCost')}
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              inputMode="decimal"
              required
              placeholder="450.00"
            />
          </div>

          <Input
            label={t('inventory.opening.note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('inventory.posting') : t('inventory.opening.post')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
