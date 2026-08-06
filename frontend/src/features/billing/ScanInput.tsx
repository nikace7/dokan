import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/lib/api/client';
import { lookupVariant } from '@/features/billing/api';
import { toPaisa } from '@/lib/money';
import { useCartStore } from '@/stores/cartStore';

/**
 * Barcode/SKU entry — the hot path of the whole app. Autofocused, Enter
 * submits, the field clears and refocuses after every add so the scanner
 * never leaves the counter operator stranded.
 */
export function ScanInput() {
  const { t } = useTranslation();
  const addLine = useCartStore((s) => s.addLine);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
        unitPricePaisa: toPaisa(variant.mrp),
        discountPaisa: 0,
      });
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
    <form onSubmit={(e) => void onSubmit(e)}>
      <label htmlFor="scan-input" className="text-sm font-medium text-slate-700">
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
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error ? (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}
