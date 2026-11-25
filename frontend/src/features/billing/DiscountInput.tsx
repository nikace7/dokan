import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { paisaToApiString } from '@/features/billing/api';
import { discountProblem, useCartStore } from '@/stores/cartStore';
import type { CartLine } from '@/stores/cartStore';

const MESSAGES = {
  invalid: 'billing.errors.discountInvalid',
  tooLarge: 'billing.errors.discountTooLarge',
};

/** Flat discount for one cart line, typed in the shop's own currency. */
export function DiscountInput({ line }: { line: CartLine }) {
  const { t } = useTranslation();
  const setDiscount = useCartStore((s) => s.setDiscount);
  const errorId = useId();
  const problem = discountProblem(line);
  const stored = line.discountPaisa === 0 ? '' : paisaToApiString(line.discountPaisa);

  return (
    <>
      <input
        aria-label={t('billing.line.discount', { name: line.label })}
        aria-invalid={problem !== null}
        aria-describedby={problem ? errorId : undefined}
        value={line.discountRaw ?? stored}
        onChange={(e) => setDiscount(line.variantId, e.target.value)}
        placeholder="0.00"
        inputMode="decimal"
        autoComplete="off"
        className={[
          'w-24 rounded border px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-500',
          problem ? 'border-red-600' : 'border-slate-300',
        ].join(' ')}
      />
      {problem ? (
        <p id={errorId} className="mt-1 w-24 text-left text-xs text-red-600 sm:ml-auto">
          {t(MESSAGES[problem])}
        </p>
      ) : null}
    </>
  );
}
