import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/lib/api/client';
import { lookupVariant } from '@/features/billing/api';
import { ItemImage } from '@/features/catalog/ui';
import { formatPaisa, toPaisa, useMoneyDisplay } from '@/lib/money';
import { useCartStore } from '@/stores/cartStore';

/** What the counter last scanned — drives the feedback card under the input. */
interface LastScan {
  variantId: string;
  imageUrl: string | null;
}

/**
 * Barcode/SKU entry — the hot path of the whole app. Autofocused, Enter
 * submits, the field clears and refocuses after every add so the scanner
 * never leaves the counter operator stranded.
 *
 * Below the input, a passive card shows the last scanned line (photo, cart
 * label, unit price, running quantity in the cart). It has no focusable
 * elements, so the scan → add → rescan keyboard flow is never interrupted.
 */
export function ScanInput() {
  const { t } = useTranslation();
  const addLine = useCartStore((s) => s.addLine);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastScan, setLastScan] = useState<LastScan | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useMoneyDisplay();

  // Running quantity comes straight from the cart, so the card follows
  // repeat scans, qty edits, and line removals without extra state.
  const lastLine = useCartStore((s) =>
    lastScan ? s.lines.find((l) => l.variantId === lastScan.variantId) : undefined,
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const variant = await lookupVariant(trimmed);
      addLine({
        variantId: variant.id,
        sku: variant.sku,
        label: `${variant.item__name} — ${variant.size} / ${variant.color}`,
        quantity: 1,
        unitPricePaisa: variant.mrp !== null ? toPaisa(variant.mrp) : 0,
        discountPaisa: 0,
      });
      setLastScan({ variantId: variant.id, imageUrl: variant.image_url ?? null });
      setCode('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? t('billing.noItemMatches', { code: trimmed })
          : err instanceof Error
            ? err.message
            : t('billing.lookupFailed'),
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div>
      <form onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="scan-input" className="text-sm font-medium">
          {t('billing.scanLabel')}
        </label>
        <input
          ref={inputRef}
          id="scan-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder={t('billing.scanPlaceholder')}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {error ? (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
      {lastScan && lastLine ? (
        <div
          role="status"
          aria-label={t('billing.lastScanAria', { defaultValue: 'Last scanned item' })}
          className="mt-3 flex items-center gap-3 rounded-md border border-border bg-muted p-2"
        >
          <ItemImage imageUrl={lastScan.imageUrl} alt={lastLine.label} className="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{lastLine.label}</p>
            <p className="text-xs text-muted-foreground">
              {t('billing.inCart', {
                qty: lastLine.quantity,
                defaultValue: 'In cart: {{qty}}',
              })}
            </p>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums">
            {formatPaisa(lastLine.unitPricePaisa, { symbol: 'auto' })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
