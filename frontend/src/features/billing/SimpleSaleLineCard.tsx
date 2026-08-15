import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ItemImage } from '@/features/catalog/ui';
import {
  lineTotalPaisa,
  priceError,
  priceRangeHint,
  qtyError,
  stockQty,
} from '@/features/billing/simpleSaleModel';
import type { SimpleLine } from '@/features/billing/simpleSaleModel';
import { formatPaisa } from '@/lib/money';

interface SimpleSaleLineCardProps {
  line: SimpleLine;
  onChange: (key: string, patch: Partial<Pick<SimpleLine, 'qty' | 'price'>>) => void;
  onRemove: (key: string) => void;
}

/**
 * One simple-sale line: the picked variant with stock + allowed price range
 * as context, and just two inputs — price (default MRP) and quantity.
 */
export function SimpleSaleLineCard({ line, onChange, onRemove }: SimpleSaleLineCardProps) {
  const { t } = useTranslation();
  const { variant } = line;
  const total = lineTotalPaisa(line);
  const hint = priceRangeHint(variant);
  // Validate loudly only once the counter has actually typed something.
  const priceIssue = line.price === '' ? null : priceError(line);
  const qtyIssue = line.qty === '' ? null : qtyError(line);

  return (
    <section
      aria-label={`${variant.item_name} — ${variant.size} / ${variant.color}`}
      className="rounded-lg border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <ItemImage imageUrl={variant.image_url} alt={variant.item_name} className="h-11 w-11" />
          <div className="min-w-0">
            <p className="truncate font-medium">
              {variant.item_name}
              <span className="text-muted-foreground">
                {' '}
                — {variant.size} / {variant.color}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {variant.sku} · {t('common.stock', { qty: variant.qty_on_hand })}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          aria-label={`Remove ${variant.item_name} ${variant.size} ${variant.color}`}
          onClick={() => onRemove(line.key)}
        >
          {t('common.remove')}
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <Input
            label={t('simpleSale.line.price')}
            inputMode="decimal"
            value={line.price}
            error={priceIssue ?? undefined}
            onChange={(event) => onChange(line.key, { price: event.target.value })}
          />
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <Input
          label={t('simpleSale.line.qty')}
          inputMode="numeric"
          type="number"
          min={1}
          max={stockQty(variant)}
          step={1}
          value={line.qty}
          error={qtyIssue ?? undefined}
          onChange={(event) => onChange(line.key, { qty: event.target.value })}
        />
      </div>

      <p className="mt-2 text-right text-sm">
        <span className="text-muted-foreground">{t('simpleSale.line.lineTotal')}: </span>
        <span className="font-semibold">{total === null ? '—' : formatPaisa(total, { symbol: 'रू ' })}</span>
      </p>
    </section>
  );
}
