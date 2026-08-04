import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { createInvoice, listSuppliers } from '@/features/purchasing/api';
import type { PurchaseInvoice } from '@/features/purchasing/api';
import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { VariantPicker } from '@/features/catalog/VariantPicker';
import { ApiError } from '@/lib/api/client';
import { MoneyError, multiplyPaisa, toPaisa } from '@/lib/money';
import type { Paisa } from '@/lib/money';
import { formatPaisa } from '@/lib/money';
import { useWorkspace } from '@/features/settings/useWorkspace';

interface DraftLine {
  variantId: string;
  label: string;
  sku: string;
  qty: string;
  unitCost: string;
}

/** Display-only line total; the server computes the authoritative one. */
export function draftLineTotalPaisa(line: DraftLine): Paisa {
  try {
    return multiplyPaisa(toPaisa(line.unitCost), Number(line.qty));
  } catch (err) {
    if (err instanceof MoneyError) {
      return 0;
    }
    throw err;
  }
}

interface PurchaseInvoiceFormProps {
  onCreated: (invoice: PurchaseInvoice) => void;
  onCancel: () => void;
}

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * New purchase invoice — saved as DRAFT (nothing moves until Confirm).
 * Lines come from the shared VariantPicker; totals shown here are
 * display-only.
 */
export function PurchaseInvoiceForm({ onCreated, onCancel }: PurchaseInvoiceFormProps) {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [supplier, setSupplier] = useState('');
  const [billDate, setBillDate] = useState(todayIso());
  const [isVatBill, setIsVatBill] = useState(false);
  const [otherCharges, setOtherCharges] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ['purchasing', 'suppliers'],
    queryFn: () => listSuppliers(),
  });

  const createMutation = useMutation({
    mutationFn: createInvoice,
    onSuccess: (invoice) => {
      void queryClient.invalidateQueries({ queryKey: ['purchasing', 'invoices'] });
      onCreated(invoice);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save the purchase invoice.'),
  });

  const addVariant = (variant: PickedVariant) => {
    setLines((current) => [
      ...current,
      {
        variantId: variant.id,
        label: `${variant.itemName} — ${variant.size} / ${variant.color}`,
        sku: variant.sku,
        qty: '1',
        unitCost: '',
      },
    ]);
  };

  const updateLine = (variantId: string, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line) => (line.variantId === variantId ? { ...line, ...patch } : line)),
    );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!supplier) {
      setError('Pick a supplier.');
      return;
    }
    if (lines.length === 0 || lines.some((l) => l.qty.trim() === '' || l.unitCost.trim() === '')) {
      setError('Every line needs a quantity and a unit cost.');
      return;
    }
    if (!workspace.branchId) {
      setError('Select an active branch first.');
      return;
    }
    createMutation.mutate({
      branch: workspace.branchId,
      supplier,
      bill_date_ad: billDate,
      is_vat_bill: isVatBill,
      other_charges: otherCharges.trim() || '0',
      paid_amount: paidAmount.trim() || '0',
      ...(note.trim() !== '' ? { note: note.trim() } : {}),
      lines: lines.map((line) => ({
        variant: line.variantId,
        qty: line.qty.trim(),
        unit_cost: line.unitCost.trim(),
        discount: '0',
      })),
    });
  };

  const totalPaisa = lines.reduce((sum, line) => sum + draftLineTotalPaisa(line), 0);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="purchase-supplier" className="text-sm font-medium text-slate-700">
            Supplier
          </label>
          <select
            id="purchase-supplier"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— pick —</option>
            {(suppliersQuery.data?.data ?? [])
              .filter((s) => s.is_active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="purchase-date" className="text-sm font-medium text-slate-700">
            Bill date (AD)
          </label>
          <input
            id="purchase-date"
            type="date"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isVatBill}
            onChange={(e) => setIsVatBill(e.target.checked)}
            className="h-4 w-4"
          />
          VAT bill
        </label>
      </div>

      <VariantPicker onPick={addVariant} placeholder="Add a line: search item…" />

      {lines.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-2 font-medium">Variant</th>
              <th className="py-2 pr-2 font-medium">Qty</th>
              <th className="py-2 pr-2 font-medium">Unit cost (रू)</th>
              <th className="py-2 pr-2 text-right font-medium">Total</th>
              <th className="py-2 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.variantId} className="border-b border-slate-100">
                <td className="py-2 pr-2">
                  <div className="font-medium text-slate-900">{line.label}</div>
                  <div className="text-xs text-slate-500">{line.sku}</div>
                </td>
                <td className="py-2 pr-2">
                  <input
                    aria-label={`Quantity for ${line.label}`}
                    value={line.qty}
                    onChange={(e) => updateLine(line.variantId, { qty: e.target.value })}
                    inputMode="decimal"
                    className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    aria-label={`Unit cost for ${line.label}`}
                    value={line.unitCost}
                    onChange={(e) => updateLine(line.variantId, { unitCost: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-28 rounded border border-slate-300 px-2 py-1 text-right"
                  />
                </td>
                <td className="py-2 pr-2 text-right">
                  {formatPaisa(draftLineTotalPaisa(line), { symbol: 'रू ' })}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    aria-label={`Remove ${line.label}`}
                    className="rounded px-2 py-1 text-red-600 hover:bg-red-50"
                    onClick={() =>
                      setLines((current) => current.filter((l) => l.variantId !== line.variantId))
                    }
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-2 text-right text-sm font-semibold text-slate-700">
                Total (display only)
              </td>
              <td className="pt-2 pr-2 text-right font-bold">
                {formatPaisa(totalPaisa, { symbol: 'रू ' })}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="purchase-other" className="text-sm font-medium text-slate-700">
            Other charges (रू)
          </label>
          <input
            id="purchase-other"
            value={otherCharges}
            onChange={(e) => setOtherCharges(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="purchase-paid" className="text-sm font-medium text-slate-700">
            Paid now (रू)
          </label>
          <input
            id="purchase-paid"
            value={paidAmount}
            onChange={(e) => setPaidAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="purchase-note" className="text-sm font-medium text-slate-700">
            Note
          </label>
          <input
            id="purchase-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={createMutation.isPending || lines.length === 0}>
          {createMutation.isPending ? 'Saving…' : 'Save draft'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
