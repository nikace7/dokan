import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { CustomerPicker } from '@/features/billing/CustomerPicker';
import { paisaToApiString } from '@/features/billing/api';
import type { PaymentMethod } from '@/features/billing/api';
import { baseSymbol, formatBaseMoney, parseAmount, useMoneyDisplay } from '@/lib/money';
import type { Paisa } from '@/lib/money';
import { billTotalPaisa, discountProblem, useCartStore, vatPaisa } from '@/stores/cartStore';

const METHODS: Array<{ id: PaymentMethod; labelKey: string }> = [
  { id: 'CASH', labelKey: 'billing.tender.cash' },
  { id: 'ESEWA', labelKey: 'billing.tender.esewa' },
  { id: 'KHALTI', labelKey: 'billing.tender.khalti' },
  { id: 'FONEPAY', labelKey: 'billing.tender.fonepay' },
  { id: 'CREDIT', labelKey: 'billing.tender.udharo' },
];

export interface Tender {
  method: PaymentMethod;
  /** Recorded on the bill — never more than its total. */
  amountPaisa: Paisa;
  /** Cash to hand back; not part of the sale. */
  changePaisa: Paisa;
  isVatBill: boolean;
}

interface PaymentPanelProps {
  busy: boolean;
  disabled?: boolean;
  allowVatBill: boolean;
  /** A VAT bill adds 13% only in a VAT-registered shop. */
  chargesVat?: boolean;
  onComplete: (tender: Tender) => void;
}

/**
 * Tender selection + amount, always in the shop's own currency. Anything left
 * due is udharo and requires a customer — the server rejects it otherwise
 * (UDHARO_REQUIRES_CUSTOMER), so we block it here first to save the round-trip.
 */
export function PaymentPanel({
  busy,
  disabled = false,
  allowVatBill,
  chargesVat = false,
  onComplete,
}: PaymentPanelProps) {
  const { t } = useTranslation();
  const lines = useCartStore((s) => s.lines);
  const customer = useCartStore((s) => s.customer);
  const isHeld = useCartStore((s) => s.heldSaleId !== null);
  const billPaisa = useCartStore(billTotalPaisa);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amountRaw, setAmountRaw] = useState('');
  const [isVatBill, setIsVatBill] = useState(false);
  const [attempted, setAttempted] = useState(false);
  useMoneyDisplay();

  // A parked bill's VAT was fixed when it was parked.
  const canPickVat = allowVatBill && !isHeld;
  const vatAdded = canPickVat && isVatBill && chargesVat ? vatPaisa(lines) : 0;
  const totalPaisa = billPaisa + vatAdded;

  const isCredit = method === 'CREDIT';
  const isBlank = isCredit || amountRaw.trim() === '';
  const typedPaisa = isBlank ? totalPaisa : parseAmount(amountRaw);
  let amountError: string | null = null;
  if (typedPaisa === null) amountError = 'billing.errors.invalidAmount';
  else if (!isBlank && typedPaisa === 0) amountError = 'billing.errors.amountPositive';
  else if (method !== 'CASH' && typedPaisa > totalPaisa)
    amountError = 'billing.errors.amountTooMuch';

  const receivedPaisa = typedPaisa ?? 0;
  const tenderPaisa = Math.min(receivedPaisa, totalPaisa);
  const paidPaisa = isCredit ? 0 : tenderPaisa;
  const duePaisa = totalPaisa - paidPaisa;
  const changePaisa = Math.max(0, receivedPaisa - totalPaisa);

  let formError: string | null = null;
  if (lines.some(discountProblem)) formError = 'billing.errors.fixDiscount';
  else if (totalPaisa <= 0) formError = 'billing.errors.amountPositive';
  else if (amountError === null && duePaisa > 0 && !customer)
    formError = 'billing.errors.udharoCustomer';

  const submit = useCallback(() => {
    setAttempted(true);
    if (amountError || formError) return;
    onComplete({
      method,
      amountPaisa: tenderPaisa,
      changePaisa,
      isVatBill: canPickVat && isVatBill,
    });
  }, [amountError, canPickVat, changePaisa, formError, isVatBill, method, onComplete, tenderPaisa]);

  useEffect(() => {
    const completeWithF9 = (event: KeyboardEvent) => {
      if (event.key !== 'F9') return;
      event.preventDefault();
      if (!busy && !disabled && lines.length > 0) submit();
    };
    window.addEventListener('keydown', completeWithF9);
    return () => window.removeEventListener('keydown', completeWithF9);
  }, [busy, disabled, lines.length, submit]);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label={t('simpleSale.paymentMethod')}
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
            {t(m.labelKey)}
          </button>
        ))}
      </div>

      {isCredit ? null : (
        <div>
          <label htmlFor="tender-amount" className="text-sm font-medium text-slate-700">
            {t(method === 'CASH' ? 'billing.cashReceived' : 'billing.amountLabel', {
              symbol: baseSymbol(),
            })}
          </label>
          <input
            id="tender-amount"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            placeholder={paisaToApiString(totalPaisa)}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={amountError !== null}
            aria-describedby={amountError ? 'tender-amount-error' : undefined}
            className={[
              'mt-1 w-full rounded-md border px-3 py-2 text-right text-lg focus:outline-none focus:ring-2 focus:ring-blue-500',
              amountError ? 'border-red-600' : 'border-slate-300',
            ].join(' ')}
          />
          {amountError ? (
            <p id="tender-amount-error" role="alert" className="mt-1 text-sm text-red-600">
              {t(amountError)}
            </p>
          ) : null}
        </div>
      )}

      <dl className="space-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm">
        {vatAdded > 0 ? <SummaryRow label={t('billing.vatAmount')} paisa={vatAdded} /> : null}
        <SummaryRow label={t('billing.billTotal')} paisa={totalPaisa} />
        <SummaryRow label={t('billing.paid')} paisa={paidPaisa} />
        <SummaryRow
          label={t('billing.dueUdharo')}
          paisa={duePaisa}
          className={duePaisa > 0 ? 'font-semibold text-red-600' : undefined}
        />
        {method === 'CASH' ? (
          <SummaryRow
            label={t('billing.changeDue')}
            paisa={changePaisa}
            className={changePaisa > 0 ? 'text-lg font-bold' : undefined}
          />
        ) : null}
      </dl>

      {duePaisa > 0 || customer ? <CustomerPicker /> : null}

      {canPickVat ? (
        <label className="flex items-center gap-2 text-sm text-slate-700 max-md:min-h-11">
          <input
            type="checkbox"
            checked={isVatBill}
            onChange={(e) => setIsVatBill(e.target.checked)}
            className="h-4 w-4"
          />
          {t('billing.vatBill')}
        </label>
      ) : null}

      {attempted && formError ? (
        <p role="alert" className="text-sm text-red-600">
          {t(formError)}
        </p>
      ) : null}

      <Button
        size="lg"
        aria-keyshortcuts="F9"
        disabled={busy || disabled || lines.length === 0}
        onClick={submit}
      >
        {busy ? t('billing.completing') : t('billing.completeSale')}
      </Button>
    </div>
  );
}

function SummaryRow({
  label,
  paisa,
  className = 'font-medium',
}: {
  label: string;
  paisa: Paisa;
  className?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-slate-600">{label}</dt>
      <dd className={className}>{formatBaseMoney(paisa)}</dd>
    </div>
  );
}
