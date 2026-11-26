import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { billNumber, paisaToApiString } from '@/features/billing/api';
import {
  createExchange,
  getReturnableLines,
  listSales,
  lookupVariant,
} from '@/features/exchange/api';
import type { ExchangePaymentMethod, SaleSummary, VariantLookup } from '@/features/exchange/api';
import { ItemImage } from '@/features/catalog/ui';
import { pickedLines, ReturnLineField } from '@/features/returns/ReturnLineField';
import { useReturnQuote } from '@/features/returns/useReturnQuote';
import { ApiError } from '@/lib/api/client';
import {
  baseSymbol,
  formatBaseMoney,
  formatNpr,
  parseAmount,
  toPaisa,
  useMoneyDisplay,
} from '@/lib/money';

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
  // A payment typed over the suggested one, for the lines it was typed against.
  const [typed, setTyped] = useState({ key: '', amount: '' });
  const [error, setError] = useState<string | null>(null);
  useMoneyDisplay();

  const returnedLines = pickedLines(linesQuery.data ?? [], returnQuantities);
  const addedLines = newLines
    .filter((line) => Number(line.qty) > 0)
    .map((line) => ({ variant: line.variant.id, qty: line.qty, discount: '0.00' }));
  const complete = returnedLines.length > 0 && addedLines.length > 0;
  const quoted = useReturnQuote(
    sale.id,
    complete ? { returned_lines: returnedLines, new_lines: addedLines } : null,
  );
  const { quote } = quoted;
  const toCollect = quote ? toPaisa(quote.to_collect) : 0;
  const toRefund = quote ? toPaisa(quote.to_refund) : 0;
  // What comes back goes off the customer's dues first; cash only for the rest.
  const offDues = quote ? Math.min(toPaisa(quote.max_credit_note), toRefund) : 0;
  const cashBack = toRefund - offDues;
  const payment = typed.key === quoted.key ? typed.amount : paisaToApiString(toCollect);
  const paymentPaisa = toCollect > 0 && payment.trim() !== '' ? parseAmount(payment) : 0;

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
      return createExchange({
        original_invoice: sale.id,
        returned_lines: returnedLines,
        new_lines: addedLines,
        payments: paymentPaisa
          ? [{ method: paymentMethod, amount: paisaToApiString(paymentPaisa) }]
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
    if (!complete || !reason.trim()) {
      setError(t('exchange.editor.required'));
      return;
    }
    if (!quote) return;
    if (paymentPaisa === null) {
      setError(t('returns.editor.badAmount'));
      return;
    }
    setError(null);
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
        <ul className="divide-y divide-border rounded-md border border-border px-3">
          {linesQuery.data.map((line) => (
            <ReturnLineField
              key={line.variant}
              line={line}
              value={returnQuantities[line.variant] ?? ''}
              onChange={(value) =>
                setReturnQuantities((current) => ({ ...current, [line.variant]: value }))
              }
            />
          ))}
        </ul>
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
                <div className="flex min-w-0 items-center gap-2">
                  <ItemImage
                    imageUrl={line.variant.image_url}
                    alt={line.variant.item__name}
                    className="h-9 w-9"
                  />
                  <div className="min-w-0">
                    <span className="font-medium">{line.variant.item__name}</span>{' '}
                    <span className="text-xs text-muted-foreground">{line.variant.sku}</span>
                  </div>
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

      <div aria-live="polite" className="mt-3 min-h-6 tabular-nums">
        {quote ? (
          <>
            <p className="text-sm">
              {t('exchange.editor.totals', {
                returned: formatBaseMoney(toPaisa(quote.return_total)),
                added: formatBaseMoney(toPaisa(quote.new_total)),
              })}
            </p>
            <p className="font-semibold">
              {toCollect > 0
                ? t('exchange.editor.customerPays', { amount: formatBaseMoney(toCollect) })
                : offDues > 0 && cashBack > 0
                  ? t('exchange.editor.offDuesAndCash', {
                      dues: formatBaseMoney(offDues),
                      cash: formatBaseMoney(cashBack),
                    })
                  : offDues > 0
                    ? t('exchange.editor.offDues', { amount: formatBaseMoney(offDues) })
                    : cashBack > 0
                      ? t('exchange.editor.giveBack', { amount: formatBaseMoney(cashBack) })
                      : t('exchange.editor.even')}
            </p>
          </>
        ) : null}
        {complete && !quote && !quoted.error ? t('common.loading') : null}
      </div>
      {quoted.error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(quoted.error, t('returns.editor.quoteError'))}
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Input
          label={t('exchange.editor.reason')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {toCollect > 0 ? (
          <>
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
                    {t(`common.methods.${method}`)}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label={t('exchange.editor.paymentAmount', { symbol: baseSymbol() })}
              inputMode="decimal"
              value={payment}
              onChange={(event) => setTyped({ key: quoted.key, amount: event.target.value })}
            />
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        className="mt-3"
        disabled={exchangeMutation.isPending || (complete && !quote)}
      >
        {exchangeMutation.isPending ? t('common.saving') : t('exchange.editor.submit')}
      </Button>
    </form>
  );
}

/** One atomic return + replacement sale; totals remain server-authoritative. */
export function ExchangePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  useMoneyDisplay();
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
      <Card titleAs="h1" title={t('exchange.title')}>
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
                {t('exchange.invoice', { number: billNumber(sale) ?? '—' })}
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
