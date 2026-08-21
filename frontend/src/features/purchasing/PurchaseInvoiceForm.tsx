import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/useAuth';
import { createInvoice, listSuppliers } from '@/features/purchasing/api';
import type { PurchaseInvoice } from '@/features/purchasing/api';
import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { VariantPicker } from '@/features/catalog/VariantPicker';
import { ApiError } from '@/lib/api/client';
import { MoneyError, multiplyPaisa, toPaisa } from '@/lib/money';
import type { Paisa } from '@/lib/money';
import { formatPaisa, useMoneyDisplay } from '@/lib/money';
import { hasPlanFeature } from '@/lib/plans';
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

const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * New purchase invoice — saved as DRAFT (nothing moves until Confirm).
 * Lines come from the shared VariantPicker; totals shown here are
 * display-only.
 */
export function PurchaseInvoiceForm({ onCreated, onCancel }: PurchaseInvoiceFormProps) {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const { user } = useAuth();
  const allowVatBill = hasPlanFeature(user, 'vat_module');
  const queryClient = useQueryClient();
  const [supplier, setSupplier] = useState('');
  const [billDate, setBillDate] = useState(todayIso());
  const [isVatBill, setIsVatBill] = useState(false);
  const [otherCharges, setOtherCharges] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  useMoneyDisplay();

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
      setError(err instanceof ApiError ? err.message : t('purchasing.form.saveError')),
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
      setError(t('purchasing.form.errSupplier'));
      return;
    }
    if (lines.length === 0 || lines.some((l) => l.qty.trim() === '' || l.unitCost.trim() === '')) {
      setError(t('purchasing.form.errLines'));
      return;
    }
    if (!workspace.branchId) {
      setError(t('purchasing.form.errBranch'));
      return;
    }
    createMutation.mutate({
      branch: workspace.branchId,
      supplier,
      bill_date_ad: billDate,
      is_vat_bill: allowVatBill && isVatBill,
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="purchase-supplier">{t('purchasing.form.supplier')}</Label>
          <select
            id="purchase-supplier"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className={selectClasses}
          >
            <option value="">{t('purchasing.form.pickSupplier')}</option>
            {(suppliersQuery.data?.data ?? [])
              .filter((s) => s.is_active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <Input
          label={t('purchasing.form.billDate')}
          id="purchase-date"
          type="date"
          value={billDate}
          onChange={(e) => setBillDate(e.target.value)}
          required
        />
        {allowVatBill ? (
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={isVatBill}
              onChange={(e) => setIsVatBill(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            {t('purchasing.form.vatBill')}
          </label>
        ) : null}
      </div>

      <VariantPicker onPick={addVariant} placeholder={t('purchasing.form.addLinePlaceholder')} />

      {lines.length > 0 ? (
        <div className="rounded-md border border-border">
          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <li
                key={line.variantId}
                className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-3 py-3"
              >
                <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                  <p className="text-sm font-medium">{line.label}</p>
                  <p className="text-xs text-muted-foreground">{line.sku}</p>
                </div>
                <div className="flex items-end gap-2">
                  <Input
                    aria-label={t('purchasing.form.quantityFor', { label: line.label })}
                    value={line.qty}
                    onChange={(e) => updateLine(line.variantId, { qty: e.target.value })}
                    inputMode="decimal"
                    className="w-20 text-right"
                  />
                  <Input
                    aria-label={t('purchasing.form.unitCostFor', { label: line.label })}
                    value={line.unitCost}
                    onChange={(e) => updateLine(line.variantId, { unitCost: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-28 text-right"
                  />
                </div>
                <p className="text-sm tabular-nums">
                  {formatPaisa(draftLineTotalPaisa(line), { symbol: 'auto' })}
                </p>
                <button
                  type="button"
                  aria-label={t('purchasing.form.remove', { label: line.label })}
                  className="rounded p-1 text-destructive hover:bg-destructive/10"
                  onClick={() =>
                    setLines((current) => current.filter((l) => l.variantId !== line.variantId))
                  }
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm">
            <span className="font-semibold text-muted-foreground">
              {t('purchasing.form.totalDisplayOnly')}
            </span>
            <span className="font-bold tabular-nums">
              {formatPaisa(totalPaisa, { symbol: 'auto' })}
            </span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label={t('purchasing.form.otherCharges')}
          id="purchase-other"
          value={otherCharges}
          onChange={(e) => setOtherCharges(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
        />
        <Input
          label={t('purchasing.form.paidNow')}
          id="purchase-paid"
          value={paidAmount}
          onChange={(e) => setPaidAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
        />
        <Input
          label={t('common.note')}
          id="purchase-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={createMutation.isPending || lines.length === 0}>
          {createMutation.isPending ? t('common.saving') : t('purchasing.form.saveDraft')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
