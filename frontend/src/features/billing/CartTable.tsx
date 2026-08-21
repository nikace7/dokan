import { useTranslation } from 'react-i18next';

import { formatPaisa, MoneyError, toPaisa, useMoneyDisplay } from '@/lib/money';
import type { CartLine } from '@/stores/cartStore';
import { cartTotalPaisa, lineTotalPaisa, useCartStore } from '@/stores/cartStore';

/**
 * The bill-in-progress. All totals are display-only; the server recomputes
 * everything when the sale posts.
 */
export function CartTable() {
  const { t } = useTranslation();
  const lines = useCartStore((s) => s.lines);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const removeLine = useCartStore((s) => s.removeLine);
  useMoneyDisplay();

  if (lines.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">{t('billing.cartEmpty')}</p>;
  }

  const onDiscountBlur = (line: CartLine, raw: string) => {
    if (raw.trim() === '') {
      return;
    }
    try {
      setDiscount(line.variantId, toPaisa(raw));
    } catch (err) {
      if (err instanceof MoneyError) {
        // Revert to the stored value by forcing a re-render of the input's
        // defaultValue; an invalid discount simply does not stick.
        setDiscount(line.variantId, line.discountPaisa);
      }
    }
  };

  return (
    // Narrow screens scroll the bill inside the card instead of breaking the
    // page layout; 36rem fits the stepper + discount column without squeeze.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="py-2 pr-2 font-medium">{t('billing.item')}</th>
            <th className="py-2 pr-2 font-medium">{t('billing.qty')}</th>
            <th className="py-2 pr-2 text-right font-medium">{t('billing.rate')}</th>
            <th className="py-2 pr-2 text-right font-medium">{t('billing.discount')}</th>
            <th className="py-2 pr-2 text-right font-medium">{t('billing.total')}</th>
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
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Decrease quantity of ${line.label}`}
                    className="h-8 w-8 rounded border border-slate-300 text-lg leading-none hover:bg-slate-50"
                    onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-medium">{line.quantity}</span>
                  <button
                    type="button"
                    aria-label={`Increase quantity of ${line.label}`}
                    className="h-8 w-8 rounded border border-slate-300 text-lg leading-none hover:bg-slate-50"
                    onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                  >
                    +
                  </button>
                </div>
              </td>
              <td className="py-2 pr-2 text-right whitespace-nowrap">
                {formatPaisa(line.unitPricePaisa, { symbol: 'auto' })}
              </td>
              <td className="py-2 pr-2 text-right">
                <input
                  aria-label={`Discount for ${line.label}`}
                  key={`${line.variantId}:${line.discountPaisa}`}
                  defaultValue={
                    line.discountPaisa === 0 ? '' : formatPaisa(line.discountPaisa, { symbol: '' })
                  }
                  placeholder="0.00"
                  inputMode="decimal"
                  className="w-24 rounded border border-slate-300 px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onBlur={(e) => onDiscountBlur(line, e.target.value)}
                />
              </td>
              <td className="py-2 pr-2 text-right font-medium whitespace-nowrap">
                {formatPaisa(lineTotalPaisa(line), { symbol: 'auto' })}
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  aria-label={`Remove ${line.label}`}
                  className="rounded px-2 py-1 text-red-600 hover:bg-red-50"
                  onClick={() => removeLine(line.variantId)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="pt-3 text-right text-sm font-semibold text-slate-700">
              {t('billing.totalDisplayOnly')}
            </td>
            <td className="pt-3 pr-2 text-right text-lg font-bold whitespace-nowrap">
              {formatPaisa(cartTotalPaisa(lines), { symbol: 'auto' })}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
