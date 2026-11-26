import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { paisaToApiString } from '@/features/billing/api';
import { discountProblem, priceProblem, useCartStore } from '@/stores/cartStore';
import type { CartLine } from '@/stores/cartStore';

const DISCOUNT_MESSAGES = {
  invalid: 'billing.errors.discountInvalid',
  tooLarge: 'billing.errors.discountTooLarge',
};

const PRICE_MESSAGES = {
  invalid: 'billing.errors.priceInvalid',
  missing: 'billing.errors.priceMissing',
};

/** Flat discount for one cart line, typed in the shop's own currency. */
export function DiscountInput({ line }: { line: CartLine }) {
  const { t } = useTranslation();
  const setDiscount = useCartStore((s) => s.setDiscount);
  const problem = discountProblem(line);
  const stored = line.discountPaisa === 0 ? '' : paisaToApiString(line.discountPaisa);
  return (
    <AmountField
      label={t('billing.line.discount', { name: line.label })}
      value={line.discountRaw ?? stored}
      error={problem ? t(DISCOUNT_MESSAGES[problem]) : null}
      onChange={(raw) => setDiscount(line.variantId, raw)}
    />
  );
}

/** One unit's price, typed in the shop's own currency; the server checks its limits. */
export function PriceInput({ line }: { line: CartLine }) {
  const { t } = useTranslation();
  const setPrice = useCartStore((s) => s.setPrice);
  const problem = priceProblem(line);
  const stored = line.unitPricePaisa === 0 ? '' : paisaToApiString(line.unitPricePaisa);
  return (
    <AmountField
      label={t('billing.line.price', { name: line.label })}
      value={line.priceRaw ?? stored}
      error={problem ? t(PRICE_MESSAGES[problem]) : null}
      onChange={(raw) => setPrice(line.variantId, raw)}
    />
  );
}

interface AmountFieldProps {
  label: string;
  value: string;
  error: string | null;
  onChange: (raw: string) => void;
}

function AmountField({ label, value, error, onChange }: AmountFieldProps) {
  const errorId = useId();
  return (
    <>
      <input
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        inputMode="decimal"
        autoComplete="off"
        className={[
          'w-24 rounded border px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-500',
          error ? 'border-red-600' : 'border-slate-300',
        ].join(' ')}
      />
      {error ? (
        <p id={errorId} className="mt-1 w-24 text-left text-xs text-red-600 sm:ml-auto">
          {error}
        </p>
      ) : null}
    </>
  );
}
