import { useTranslation } from 'react-i18next';

import { DiscountInput, PriceInput } from '@/features/billing/DiscountInput';
import { baseSymbol, formatPaisa, useMoneyDisplay } from '@/lib/money';
import { cn } from '@/lib/utils';
import { billTotalPaisa, lineTotalPaisa, useCartStore } from '@/stores/cartStore';

/** Phone layout: the column heading moves into the cell itself. */
const phoneLabel =
  'max-sm:before:block max-sm:before:text-xs max-sm:before:font-normal max-sm:before:text-slate-500 max-sm:before:content-[attr(data-label)]';

/**
 * The bill-in-progress. All totals are display-only; the server recomputes
 * everything when the sale posts.
 */
export function CartTable() {
  const { t } = useTranslation();
  const lines = useCartStore((s) => s.lines);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const totalPaisa = useCartStore(billTotalPaisa);
  const removeLine = useCartStore((s) => s.removeLine);
  useMoneyDisplay();

  if (lines.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">{t('billing.cartEmpty')}</p>;
  }

  const discountLabel = `${t('billing.discount')} (${baseSymbol()})`;
  const rateLabel = `${t('billing.rate')} (${baseSymbol()})`;

  return (
    // A table from `sm` up (scrolling inside the card when it is narrower than
    // 36rem); on a phone each line becomes a card that needs no scrolling.
    <div className="overflow-x-auto">
      <table className="w-full text-sm max-sm:block sm:min-w-[36rem]">
        <thead className="max-sm:hidden">
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="py-2 pr-2 font-medium">{t('billing.item')}</th>
            <th className="py-2 pr-2 font-medium">{t('billing.qty')}</th>
            <th className="py-2 pr-2 text-right font-medium">{rateLabel}</th>
            <th className="py-2 pr-2 text-right font-medium">{discountLabel}</th>
            <th className="py-2 pr-2 text-right font-medium">{t('billing.total')}</th>
            <th className="py-2 font-medium" aria-label={t('common.actions')} />
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {lines.map((line) => (
            <tr
              key={line.variantId}
              className="border-b border-slate-100 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-end max-sm:gap-x-3 max-sm:py-2"
            >
              <td className="py-2 pr-2">
                <div className="font-medium text-slate-900">{line.label}</div>
                <div className="text-xs text-slate-500">{line.sku}</div>
              </td>
              <td className="py-2 pr-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t('billing.line.decrease', { name: line.label })}
                    className="h-8 w-8 rounded border border-slate-300 max-md:h-11 max-md:w-11 text-lg leading-none hover:bg-slate-50 disabled:opacity-40"
                    onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-medium">{line.quantity}</span>
                  <button
                    type="button"
                    aria-label={t('billing.line.increase', { name: line.label })}
                    className="h-8 w-8 rounded border border-slate-300 max-md:h-11 max-md:w-11 text-lg leading-none hover:bg-slate-50 disabled:opacity-40"
                    onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                  >
                    +
                  </button>
                </div>
              </td>
              <td
                data-label={rateLabel}
                className={cn(
                  'py-2 pr-2 text-right max-sm:self-start max-sm:text-left',
                  phoneLabel,
                )}
              >
                <PriceInput line={line} />
              </td>
              <td
                data-label={discountLabel}
                className={cn(
                  'py-2 pr-2 text-right max-sm:self-start max-sm:text-left',
                  phoneLabel,
                )}
              >
                <DiscountInput line={line} />
              </td>
              <td
                data-label={t('billing.total')}
                className={cn(
                  'py-2 pr-2 text-right font-medium whitespace-nowrap max-sm:self-start',
                  phoneLabel,
                )}
              >
                {formatPaisa(lineTotalPaisa(line), { symbol: 'auto' })}
              </td>
              <td className="py-2 text-right max-sm:col-start-2 max-sm:row-start-1">
                <button
                  type="button"
                  aria-label={t('billing.line.remove', { name: line.label })}
                  className="rounded px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40 max-md:h-11 max-md:w-11"
                  onClick={() => removeLine(line.variantId)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="max-sm:block">
          <tr className="max-sm:flex max-sm:items-baseline max-sm:justify-between">
            <td colSpan={4} className="pt-3 text-right text-sm font-semibold text-slate-700">
              {t('billing.totalDisplayOnly')}
            </td>
            <td className="pt-3 pr-2 text-right text-lg font-bold whitespace-nowrap">
              {formatPaisa(totalPaisa, { symbol: 'auto' })}
            </td>
            <td className="max-sm:hidden" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
