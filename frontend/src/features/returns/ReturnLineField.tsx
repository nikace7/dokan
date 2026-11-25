import { useTranslation } from 'react-i18next';

import type { ReturnableLine } from '@/features/returns/api';
import { formatQty } from '@/lib/quantity';

/** The lines that really are coming back: a blank or zero quantity is not one. */
export function pickedLines(lines: ReturnableLine[], quantities: Record<string, string>) {
  return lines
    .map((line) => ({ variant: line.variant, qty: quantities[line.variant] ?? '' }))
    .filter((line) => Number(line.qty) > 0);
}

/** One line of the original bill, with how many of it are coming back. */
export function ReturnLineField({
  line,
  value,
  onChange,
}: {
  line: ReturnableLine;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{line.item_name}</span>{' '}
        <span className="text-xs text-muted-foreground">{line.sku}</span>
        <span className="block text-xs text-muted-foreground">
          {t('returns.line.remaining', { remaining: formatQty(line.remaining) })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('returns.line.returnQty')}</span>
        <input
          aria-label={t('returns.line.qtyAria', { name: line.item_name })}
          type="number"
          min="0"
          max={line.remaining}
          step="0.001"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-24 rounded-md border border-input bg-background px-2 py-1 text-right text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </li>
  );
}
