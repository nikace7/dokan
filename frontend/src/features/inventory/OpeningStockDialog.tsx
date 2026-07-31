import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { postOpeningStock } from '@/features/inventory/api';
import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { VariantPicker } from '@/features/catalog/VariantPicker';
import { ApiError } from '@/lib/api/client';
import { demoConfig } from '@/lib/config';

interface OpeningStockDialogProps {
  onClose: () => void;
  onPosted: () => void;
}

/**
 * "Add opening stock" dialog. Writes one OPENING ledger movement — the
 * only way stock enters the system besides purchasing (invariant 1).
 * Branch comes from the demo config until a branch list endpoint exists.
 */
export function OpeningStockDialog({ onClose, onPosted }: OpeningStockDialogProps) {
  const [variant, setVariant] = useState<PickedVariant | null>(null);
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: postOpeningStock,
    onSuccess: onPosted,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not post opening stock.'),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!variant) {
      setError('Pick a variant first.');
      return;
    }
    mutation.mutate({
      branch: demoConfig.branchId,
      variant: variant.id,
      qty: qty.trim(),
      unit_cost: unitCost.trim(),
      ...(note.trim() !== '' ? { note: note.trim() } : {}),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add opening stock"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Add opening stock</h2>
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
          {variant ? (
            <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <span className="font-medium">
                {variant.itemName} — {variant.size} / {variant.color}
                <span className="ml-1 text-xs text-slate-500">{variant.sku}</span>
              </span>
              <button
                type="button"
                className="text-blue-700 hover:underline"
                onClick={() => setVariant(null)}
              >
                Change
              </button>
            </div>
          ) : (
            <VariantPicker onPick={setVariant} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="opening-qty" className="text-sm font-medium text-slate-700">
                Quantity
              </label>
              <input
                id="opening-qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                required
                placeholder="20"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="opening-cost" className="text-sm font-medium text-slate-700">
                Unit cost (रू)
              </label>
              <input
                id="opening-cost"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                inputMode="decimal"
                required
                placeholder="450.00"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="opening-note" className="text-sm font-medium text-slate-700">
              Note (optional)
            </label>
            <input
              id="opening-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Posting…' : 'Post opening stock'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
