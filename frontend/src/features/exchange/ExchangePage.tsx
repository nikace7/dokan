import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import {
  createExchange,
  getReturnableLines,
  listSales,
  lookupVariant,
} from '@/features/exchange/api';
import type {
  ExchangePaymentMethod,
  ReturnableLine,
  SaleSummary,
  VariantLookup,
} from '@/features/exchange/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

const PAYMENT_METHODS: ExchangePaymentMethod[] = [
  'CASH',
  'ESEWA',
  'KHALTI',
  'FONEPAY',
  'CARD',
  'BANK',
  'CREDIT',
];

const lineInputClasses =
  'w-24 rounded-md border border-input bg-background px-2 py-1 text-right text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

interface NewLine {
  variant: VariantLookup;
  qty: string;
}

function ExchangeEditor({ sale, onRecorded }: { sale: SaleSummary; onRecorded: () => void }) {
  const { t } = useTranslation();
  const linesQuery = useQuery({
    queryKey: ['exchange', 'returnable', sale.id],
    queryFn: () => getReturnableLines(sale.id),
  });
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ExchangePaymentMethod>('CASH');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const lookupMutation = useMutation({
    mutationFn: () => lookupVariant(code.trim()),
    onSuccess: (variant) => {
      setNewLines((current) => [...current, { variant, qty: '1' }]);
      setCode('');
      setError(null);
    },
    onError: (err) => setError(errorMessage(err, t('exchange.editor.lookupError'))),
  });

  const exchangeMutation = useMutation({
    mutationFn: () => {
      const returnedLines = (linesQuery.data ?? [])
        .map((line) => ({ variant: line.variant, qty: returnQuantities[line.variant] ?? '' }))
        .filter((line) => line.qty.trim() !== '');
      return createExchange({
        original_invoice: sale.id,
        returned_lines: returnedLines,
        new_lines: newLines.map((line) => ({
          variant: line.variant.id,
          qty: line.qty,
          discount: '0.00',
        })),
        payments: paymentAmount.trim()
          ? [{ method: paymentMethod, amount: paymentAmount.trim() }]
          : [],
        reason: reason.trim(),
      });
    },
    onSuccess: onRecorded,
    onError: (err) => setError(errorMessage(err, t('exchange.editor.saveError'))),
  });

  function addItem() {
    if (code.trim()) lookupMutation.mutate();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hasReturn = Object.values(returnQuantities).some((qty) => qty.trim() !== '');
    if (!hasReturn || newLines.length === 0 || !reason.trim()) {
      setError(t('exchange.editor.required'));
      return;
    }
    exchangeMutation.mutate();
  }

  return (
    <form onSubmit={submit} className="border-t border-border px-2 py-3">
      {linesQuery.isFetching ? (
        <p className="text-sm text-muted-foreground">{t('exchange.editor.loadingLines')}</p>
      ) : null}
      {linesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(linesQuery.error, t('exchange.editor.loadLinesError'))}
        </p>
      ) : null}
      {linesQuery.data && linesQuery.data.length > 0 ? (
        <LineList
          lines={linesQuery.data}
          quantities={returnQuantities}
          onChange={(variant, value) =>
            setReturnQuantities((current) => ({ ...current, [variant]: value }))
          }
        />
      ) : null}

      <div className="mt-4 rounded-md border border-border p-3">
        <h3 className="text-sm font-semibold">{t('exchange.editor.newItem')}</h3>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Input
            label={t('exchange.editor.newItemCode')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('exchange.editor.codePlaceholder')}
          />
          <Button type="button" size="sm" onClick={addItem} disabled={lookupMutation.isPending}>
            {lookupMutation.isPending ? t('exchange.editor.finding') : t('exchange.editor.addItem')}
          </Button>
        </div>
        {newLines.length > 0 ? (
          <ul className="mt-3 divide-y divide-border rounded-md border border-border px-3">
            {newLines.map((line, index) => (
              <li
                key={`${line.variant.id}-${index}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium">{line.variant.item__name}</span>{' '}
                  <span className="text-xs text-muted-foreground">{line.variant.sku}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('exchange.editor.qty')}</span>
                  <input
                    aria-label={t('exchange.editor.newQtyAria', {
                      name: line.variant.item__name,
                    })}
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={line.qty}
                    onChange={(event) =>
                      setNewLines((current) =>
                        current.map((item, currentIndex) =>
                          currentIndex === index ? { ...item, qty: event.target.value } : item,
                        ),
                      )
                    }
                    className={lineInputClasses}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Input
          label={t('exchange.editor.reason')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`exchange-payment-method-${sale.id}`}>
            {t('exchange.editor.paymentMethod')}
          </Label>
          <select
            id={`exchange-payment-method-${sale.id}`}
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value as ExchangePaymentMethod)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </div>
        <Input
          label={t('exchange.editor.paymentAmount')}
          type="number"
          min="0.01"
          step="0.01"
          value={paymentAmount}
          onChange={(event) => setPaymentAmount(event.target.value)}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('exchange.editor.serverNote')}</p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="mt-3" disabled={exchangeMutation.isPending}>
        {exchangeMutation.isPending ? t('common.saving') : t('exchange.editor.submit')}
      </Button>
    </form>
  );
}

function LineList({
  lines,
  quantities,
  onChange,
}: {
  lines: ReturnableLine[];
  quantities: Record<string, string>;
  onChange: (variant: string, value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-border rounded-md border border-border px-3">
      {lines.map((line) => (
        <li
          key={line.variant}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 text-sm"
        >
          <div className="min-w-0">
            <span className="font-medium">{line.item_name}</span>{' '}
            <span className="text-xs text-muted-foreground">{line.sku}</span>
            <span className="block text-xs text-muted-foreground">
              {t('exchange.line.remaining', { remaining: line.remaining })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('exchange.line.returnQty')}</span>
            <input
              aria-label={t('exchange.line.qtyAria', { name: line.item_name })}
              type="number"
              min="0"
              max={line.remaining}
              step="0.001"
              value={quantities[line.variant] ?? ''}
              onChange={(event) => onChange(line.variant, event.target.value)}
              className={lineInputClasses}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One atomic return + replacement sale; totals remain server-authoritative. */
export function ExchangePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const salesQuery = useQuery({
    queryKey: ['exchange', 'sales', page],
    queryFn: () => listSales(page),
  });
  const sales = (salesQuery.data?.data ?? []).filter((sale) => sale.doc_type === 'SALE');
  const meta = salesQuery.data?.meta ?? null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      {statusMessage ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {statusMessage}
        </p>
      ) : null}
      <Card title={t('exchange.title')}>
        <p className="mb-3 text-sm text-muted-foreground">{t('exchange.help')}</p>
        {salesQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('exchange.loading')}</p>
        ) : null}
        {salesQuery.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage(salesQuery.error, t('exchange.loadError'))}
          </p>
        ) : null}
        {salesQuery.data && sales.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('exchange.empty')}</p>
        ) : null}
        {sales.map((sale) => (
          <div key={sale.id} className="border-b border-border last:border-0">
            <button
              type="button"
              aria-expanded={expandedId === sale.id}
              onClick={() => setExpandedId((current) => (current === sale.id ? null : sale.id))}
              className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-3 text-left text-sm hover:bg-muted/50"
            >
              <span className="font-medium">
                {t('exchange.invoice', { number: sale.invoice_no ?? '—' })}
              </span>
              <span className="text-muted-foreground">
                {sale.customer_name || t('common.walkIn')}
              </span>
              <span className="text-muted-foreground">{sale.business_date_bs}</span>
              <span className="tabular-nums">{formatNpr(sale.total)}</span>
            </button>
            {expandedId === sale.id ? (
              <ExchangeEditor
                sale={sale}
                onRecorded={() => {
                  setStatusMessage(t('exchange.recorded'));
                  setExpandedId(null);
                  void queryClient.invalidateQueries({ queryKey: ['exchange', 'sales'] });
                }}
              />
            ) : null}
          </div>
        ))}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('common.pageOf', { page: meta.page, total: meta.total_pages })} (
              {t('exchange.count', { count: meta.count })})
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('common.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
