import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { billNumber, paisaToApiString, parseBillNumber } from '@/features/billing/api';
import { createReturn, getReturnableLines, listSales } from '@/features/returns/api';
import type { RefundMethod, SaleSummary } from '@/features/returns/api';
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

const REFUND_METHODS: RefundMethod[] = ['CASH', 'QR', 'CARD', 'BANK'];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

/** Blank means nothing; null means it is not an amount. */
function amountOrZero(text: string): number | null {
  return text.trim() === '' ? 0 : parseAmount(text);
}

function ReturnEditor({ sale, onRecorded }: { sale: SaleSummary; onRecorded: () => void }) {
  const { t } = useTranslation();
  const linesQuery = useQuery({
    queryKey: ['returns', 'returnable', sale.id],
    queryFn: () => getReturnableLines(sale.id),
  });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('CASH');
  // Amounts typed over the suggested ones, for the lines they were typed against.
  const [typed, setTyped] = useState<{ key: string; credit?: string; money?: string }>({ key: '' });
  const [error, setError] = useState<string | null>(null);
  useMoneyDisplay();

  const lines = pickedLines(linesQuery.data ?? [], quantities);
  const quoted = useReturnQuote(sale.id, lines.length ? { returned_lines: lines } : null);
  const { quote } = quoted;
  const edits = typed.key === quoted.key ? typed : { key: quoted.key };
  const value = quote ? toPaisa(quote.return_total) : 0;
  const maxCredit = quote ? toPaisa(quote.max_credit_note) : 0;
  // Dues come off first; only what is left over is handed back.
  const credit = edits.credit ?? paisaToApiString(maxCredit);
  const creditPaisa = maxCredit > 0 ? amountOrZero(credit) : 0;
  const money = edits.money ?? paisaToApiString(Math.max(0, value - (creditPaisa ?? 0)));
  const moneyPaisa = amountOrZero(money);
  const unreturned =
    creditPaisa === null || moneyPaisa === null ? 0 : value - creditPaisa - moneyPaisa;

  const mutation = useMutation({
    mutationFn: () => {
      const refunds = [
        { method: 'CREDIT_NOTE' as RefundMethod, paisa: creditPaisa ?? 0 },
        { method: refundMethod, paisa: moneyPaisa ?? 0 },
      ]
        .filter((refund) => refund.paisa > 0)
        .map(({ method, paisa }) => ({ method, amount: paisaToApiString(paisa) }));
      return createReturn({
        original_invoice: sale.id,
        lines,
        reason: reason.trim(),
        refunds: refunds.length ? refunds : undefined,
      });
    },
    onSuccess: onRecorded,
    onError: (err) => setError(errorMessage(err, t('returns.editor.saveError'))),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lines.length === 0 || !reason.trim()) {
      setError(t('returns.editor.required'));
      return;
    }
    if (!quote) return;
    if (creditPaisa === null || moneyPaisa === null) {
      setError(t('returns.editor.badAmount'));
      return;
    }
    if (unreturned < 0) {
      setError(t('returns.editor.tooMuch', { amount: formatBaseMoney(value) }));
      return;
    }
    setError(null);
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} className="border-t border-border px-2 py-3">
      {linesQuery.isFetching ? (
        <p className="text-sm text-muted-foreground">{t('returns.editor.loadingLines')}</p>
      ) : null}
      {linesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(linesQuery.error, t('returns.editor.loadLinesError'))}
        </p>
      ) : null}
      {linesQuery.data && linesQuery.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('returns.editor.allReturned')}</p>
      ) : null}
      {linesQuery.data && linesQuery.data.length > 0 ? (
        <>
          <ul className="divide-y divide-border rounded-md border border-border px-3">
            {linesQuery.data.map((line) => (
              <ReturnLineField
                key={line.variant}
                line={line}
                value={quantities[line.variant] ?? ''}
                onChange={(value) =>
                  setQuantities((current) => ({ ...current, [line.variant]: value }))
                }
              />
            ))}
          </ul>
          <p aria-live="polite" className="mt-3 min-h-6 font-semibold tabular-nums">
            {quote ? t('returns.editor.value', { amount: formatBaseMoney(value) }) : null}
            {lines.length && !quote && !quoted.error ? t('common.loading') : null}
          </p>
          {quoted.error ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(quoted.error, t('returns.editor.quoteError'))}
            </p>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label={t('returns.editor.reason')}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {maxCredit > 0 ? (
              <Input
                label={t('returns.editor.creditAmount', { symbol: baseSymbol() })}
                inputMode="decimal"
                value={credit}
                onChange={(event) => setTyped({ ...edits, credit: event.target.value })}
              />
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`refund-method-${sale.id}`}>{t('returns.editor.refundMethod')}</Label>
              <select
                id={`refund-method-${sale.id}`}
                value={refundMethod}
                onChange={(event) => setRefundMethod(event.target.value as RefundMethod)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {REFUND_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t(`common.methods.${method}`)}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label={t('returns.editor.refundAmount', { symbol: baseSymbol() })}
              inputMode="decimal"
              disabled={!quote}
              value={quote ? money : ''}
              onChange={(event) => setTyped({ ...edits, money: event.target.value })}
            />
          </div>
          {unreturned > 0 ? (
            <p className="mt-2 text-sm">
              {t('returns.editor.notGivenBack', { amount: formatBaseMoney(unreturned) })}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="mt-3"
            disabled={mutation.isPending || (lines.length > 0 && !quote)}
          >
            {mutation.isPending ? t('common.saving') : t('returns.editor.submit')}
          </Button>
        </>
      ) : null}
    </form>
  );
}

/** Return completed sale lines as immutable credit-note documents. */
export function ReturnsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [invoiceInput, setInvoiceInput] = useState('');
  const [searchInvoice, setSearchInvoice] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  useMoneyDisplay();
  const salesQuery = useQuery({
    queryKey: ['returns', 'sales', page, searchInvoice],
    queryFn: () => listSales(page, searchInvoice ?? undefined),
  });
  const sales = (salesQuery.data?.data ?? []).filter((sale) => sale.doc_type === 'SALE');
  const meta = salesQuery.data?.meta ?? null;

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const number = parseBillNumber(invoiceInput);
    // RET-7 is a credit note; bill 7 is a different sale.
    if (number === null || /^\s*RET-/i.test(invoiceInput)) {
      setSearchError(t('returns.search.invalid'));
      return;
    }
    setSearchError(null);
    setStatusMessage(null);
    setExpandedId(null);
    setPage(1);
    setSearchInvoice(number);
  }

  function clearSearch() {
    setInvoiceInput('');
    setSearchError(null);
    setSearchInvoice(null);
    setPage(1);
    setExpandedId(null);
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      {statusMessage ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {statusMessage}
        </p>
      ) : null}
      <Card titleAs="h1" title={t('returns.title')}>
        <p className="mb-3 text-sm text-muted-foreground">{t('returns.help')}</p>
        <form onSubmit={submitSearch} className="mb-3 flex flex-wrap items-end gap-2">
          <Input
            label={t('returns.search.label')}
            value={invoiceInput}
            onChange={(event) => setInvoiceInput(event.target.value)}
            placeholder={t('returns.search.placeholder')}
            inputMode="numeric"
            className="w-32"
            error={searchError ?? undefined}
          />
          <Button type="submit" variant="secondary" size="md">
            {t('returns.search.button')}
          </Button>
          {searchInvoice != null ? (
            <Button type="button" variant="ghost" size="md" onClick={clearSearch}>
              {t('returns.search.clear')}
            </Button>
          ) : null}
        </form>
        {salesQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('returns.loading')}</p>
        ) : null}
        {salesQuery.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage(salesQuery.error, t('returns.loadError'))}
          </p>
        ) : null}
        {salesQuery.data && sales.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {searchInvoice != null
              ? t('returns.search.empty', { number: searchInvoice })
              : t('returns.empty')}
          </p>
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
                {t('returns.invoice', { number: billNumber(sale) ?? '—' })}
              </span>
              <span className="text-muted-foreground">
                {sale.customer_name || t('common.walkIn')}
              </span>
              <span className="text-muted-foreground">{sale.business_date_bs}</span>
              <span className="tabular-nums">{formatNpr(sale.total)}</span>
            </button>
            {expandedId === sale.id ? (
              <ReturnEditor
                sale={sale}
                onRecorded={() => {
                  setStatusMessage(t('returns.recorded'));
                  setExpandedId(null);
                  void queryClient.invalidateQueries({ queryKey: ['returns', 'sales'] });
                }}
              />
            ) : null}
          </div>
        ))}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('common.pageOf', { page: meta.page, total: meta.total_pages })} (
              {t('returns.count', { count: meta.count })})
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
