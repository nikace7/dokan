import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { VariantPicker } from '@/features/catalog/VariantPicker';
import { postAdjustment, postWriteOff } from '@/features/inventory/api';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { ApiError } from '@/lib/api/client';

interface StockOperationDialogProps {
  kind: 'adjustment' | 'write-off';
  onClose: () => void;
  onPosted: () => void;
}

export function StockOperationDialog({ kind, onClose, onPosted }: StockOperationDialogProps) {
  const workspace = useWorkspace();
  const [variant, setVariant] = useState<PickedVariant | null>(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isAdjustment = kind === 'adjustment';

  const mutation = useMutation({
    mutationFn: () => {
      if (!variant || !workspace.branchId) throw new Error('Missing stock operation context.');
      const common = { branch: workspace.branchId, variant: variant.id, reason: reason.trim() };
      return isAdjustment
        ? postAdjustment({ ...common, qty_delta: qty.trim() })
        : postWriteOff({ ...common, qty: qty.trim() });
    },
    onSuccess: onPosted,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not post the stock operation.'),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!variant) return setError('Pick a variant first.');
    if (!workspace.branchId) return setError('Select an active branch first.');
    if (Number(qty) === 0 || (!isAdjustment && Number(qty) < 0)) {
      return setError(
        isAdjustment ? 'Quantity change cannot be zero.' : 'Quantity must be positive.',
      );
    }
    mutation.mutate();
  };

  const title = isAdjustment ? 'Adjust stock' : 'Write off damage';
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent aria-label={title} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {variant ? (
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
                Change
              </button>
            </div>
          ) : (
            <VariantPicker onPick={setVariant} />
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stock-op-qty">
              {isAdjustment ? 'Quantity change' : 'Quantity damaged'}
            </Label>
            <Input
              id="stock-op-qty"
              aria-label={isAdjustment ? 'Quantity change' : 'Quantity damaged'}
              type="number"
              step="0.001"
              min={isAdjustment ? undefined : '0.001'}
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stock-op-reason">Reason</Label>
            <textarea
              id="stock-op-reason"
              aria-label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              maxLength={500}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? 'Posting…'
                : isAdjustment
                  ? 'Post adjustment'
                  : 'Post write-off'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
