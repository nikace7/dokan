import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { CustomerPicker } from '@/features/billing/CustomerPicker';
import type { PaymentMethod } from '@/features/billing/api';
import { formatPaisa, toPaisa } from '@/lib/money';
import type { Paisa } from '@/lib/money';
import { cartTotalPaisa, useCartStore } from '@/stores/cartStore';

const METHODS: Array<{ id: PaymentMethod; label: string }> = [
  { id: 'CASH', label: 'Cash / नगद' },
  { id: 'ESEWA', label: 'eSewa' },
  { id: 'KHALTI', label: 'Khalti' },
  { id: 'FONEPAY', label: 'Fonepay' },
  { id: 'CREDIT', label: 'Udharo / उधारो' },
];

export interface Tender {
  method: PaymentMethod;
  amountPaisa: Paisa;
  isVatBill: boolean;
}

interface PaymentPanelProps {
  busy: boolean;
  onComplete: (tender: Tender) => void;
}

/**
 * Tender selection + amount. CREDIT (udharo) requires a customer — the
 * server rejects it otherwise (UDHARO_REQUIRES_CUSTOMER), so we block it
 * here first to save the round-trip.
 */
export function PaymentPanel({ busy, onComplete }: PaymentPanelProps) {
  const lines = useCartStore((s) => s.lines);
  const customer = useCartStore((s) => s.customer);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amountRaw, setAmountRaw] = useState('');
  const [isVatBill, setIsVatBill] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPaisa = cartTotalPaisa(lines);
  let tenderPaisa: Paisa | null = null;
  if (amountRaw.trim() !== '') {
    try {
      tenderPaisa = toPaisa(amountRaw);
    } catch {
      // surfaced on submit; typing partial input must not blow up rendering
    }
  }
  const effectiveTender = tenderPaisa ?? totalPaisa;
  const paidPaisa = method === 'CREDIT' ? 0 : effectiveTender;
  const duePaisa = totalPaisa - paidPaisa;

  const submit = () => {
    setError(null);
    if (lines.length === 0) {
      setError('Add at least one item to the bill.');
      return;
    }
    if (tenderPaisa === null && amountRaw.trim() !== '') {
      setError('Enter a valid amount (e.g. 1500.00).');
      return;
    }
    if (effectiveTender <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    if (method === 'CREDIT' && !customer) {
      setError('Udharo requires a customer — search and pick one above.');
      return;
    }
    onComplete({ method, amountPaisa: effectiveTender, isVatBill });
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Payment method"
        className="grid grid-cols-3 gap-2"
      >
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={method === m.id}
            onClick={() => setMethod(m.id)}
            className={[
              'rounded-md border px-2 py-3 text-sm font-medium',
              method === m.id
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            ].join(' ')}
          >
            {m.label}
          </button>
        ))}
      </div>

      {method === 'CREDIT' ? <CustomerPicker /> : null}

      <div>
        <label htmlFor="tender-amount" className="text-sm font-medium text-slate-700">
          Amount (रू) — blank = full total
        </label>
        <input
          id="tender-amount"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value)}
          placeholder={formatPaisa(totalPaisa, { symbol: '' })}
          inputMode="decimal"
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-right text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <dl className="space-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-600">Bill total</dt>
          <dd className="font-medium">{formatPaisa(totalPaisa, { symbol: 'रू ' })}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-600">Paid</dt>
          <dd className="font-medium">{formatPaisa(Math.max(0, paidPaisa), { symbol: 'रू ' })}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-600">Due (udharo)</dt>
          <dd className={duePaisa > 0 ? 'font-semibold text-red-600' : 'font-medium'}>
            {formatPaisa(Math.max(0, duePaisa), { symbol: 'रू ' })}
          </dd>
        </div>
      </dl>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={isVatBill}
          onChange={(e) => setIsVatBill(e.target.checked)}
          className="h-4 w-4"
        />
        VAT bill / भ्याट बिजक
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <Button size="lg" disabled={busy || lines.length === 0} onClick={submit}>
        {busy ? 'Completing…' : 'Complete sale / बिल काट्नुहोस्'}
      </Button>
    </div>
  );
}
