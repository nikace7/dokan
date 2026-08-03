import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

interface NewLine {
  variant: VariantLookup;
  qty: string;
}

function ExchangeEditor({ sale, onRecorded }: { sale: SaleSummary; onRecorded: () => void }) {
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
    onError: (err) => setError(errorMessage(err, 'Could not find that item.')),
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
    onError: (err) => setError(errorMessage(err, 'Could not record the exchange.')),
  });

  function addItem() {
    if (code.trim()) lookupMutation.mutate();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hasReturn = Object.values(returnQuantities).some((qty) => qty.trim() !== '');
    if (!hasReturn || newLines.length === 0 || !reason.trim()) {
      setError('Select a returned quantity, add a new item, and enter a reason.');
      return;
    }
    exchangeMutation.mutate();
  }

  return (
    <form onSubmit={submit} className="border-t border-slate-200 px-2 py-3">
      {linesQuery.isFetching ? (
        <p className="text-sm text-slate-500">Loading returned lines…</p>
      ) : null}
      {linesQuery.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(linesQuery.error, 'Could not load returnable lines.')}
        </p>
      ) : null}
      {linesQuery.data && linesQuery.data.length > 0 ? (
        <LineTable
          lines={linesQuery.data}
          quantities={returnQuantities}
          onChange={(variant, value) =>
            setReturnQuantities((current) => ({ ...current, [variant]: value }))
          }
        />
      ) : null}

      <div className="mt-4 rounded-md border border-slate-200 p-3">
        <h3 className="text-sm font-semibold">New item</h3>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Input
            label="New item code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Barcode or SKU"
          />
          <Button type="button" size="sm" onClick={addItem} disabled={lookupMutation.isPending}>
            {lookupMutation.isPending ? 'Finding…' : 'Add item'}
          </Button>
        </div>
        {newLines.length > 0 ? (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-1 pr-2 font-medium">Item</th>
                <th className="py-1 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {newLines.map((line, index) => (
                <tr key={`${line.variant.id}-${index}`} className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    {line.variant.item__name}{' '}
                    <span className="text-xs text-slate-500">{line.variant.sku}</span>
                  </td>
                  <td className="py-2 text-right">
                    <input
                      aria-label={`New quantity for ${line.variant.item__name}`}
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
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Input label="Reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`exchange-payment-method-${sale.id}`}
            className="text-sm font-medium text-slate-700"
          >
            Extra payment method (optional)
          </label>
          <select
            id={`exchange-payment-method-${sale.id}`}
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value as ExchangePaymentMethod)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Extra payment (NPR, optional)"
          type="number"
          min="0.01"
          step="0.01"
          value={paymentAmount}
          onChange={(event) => setPaymentAmount(event.target.value)}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Prices and the difference are calculated by the server. Add extra payment only when the new
        item total exceeds the return credit.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="mt-3" disabled={exchangeMutation.isPending}>
        {exchangeMutation.isPending ? 'Saving…' : 'Record exchange'}
      </Button>
    </form>
  );
}

function LineTable({
  lines,
  quantities,
  onChange,
}: {
  lines: ReturnableLine[];
  quantities: Record<string, string>;
  onChange: (variant: string, value: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-1 pr-2 font-medium">Returned item</th>
          <th className="py-1 pr-2 text-right font-medium">Remaining</th>
          <th className="py-1 text-right font-medium">Return qty</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.variant} className="border-b border-slate-100">
            <td className="py-2 pr-2">
              <span className="font-medium">{line.item_name}</span>{' '}
              <span className="text-xs text-slate-500">{line.sku}</span>
            </td>
            <td className="py-2 pr-2 text-right">{line.remaining}</td>
            <td className="py-2 text-right">
              <input
                aria-label={`Return quantity for ${line.item_name}`}
                type="number"
                min="0"
                max={line.remaining}
                step="0.001"
                value={quantities[line.variant] ?? ''}
                onChange={(event) => onChange(line.variant, event.target.value)}
                className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One atomic return + replacement sale; totals remain server-authoritative. */
export function ExchangePage() {
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
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {statusMessage}
        </p>
      ) : null}
      <Card title="Exchanges / साटफेर">
        <p className="mb-3 text-sm text-slate-600">
          Select the original bill, choose returned quantities, and add the replacement items.
        </p>
        {salesQuery.isFetching ? (
          <p className="py-4 text-sm text-slate-500">Loading sales…</p>
        ) : null}
        {salesQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {errorMessage(salesQuery.error, 'Could not load completed sales.')}
          </p>
        ) : null}
        {salesQuery.data && sales.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No completed sales found.</p>
        ) : null}
        {sales.map((sale) => (
          <div key={sale.id} className="border-b border-slate-100 last:border-0">
            <button
              type="button"
              aria-expanded={expandedId === sale.id}
              onClick={() => setExpandedId((current) => (current === sale.id ? null : sale.id))}
              className="flex w-full items-center justify-between gap-2 px-2 py-3 text-left text-sm hover:bg-slate-50"
            >
              <span className="font-medium">Invoice {sale.invoice_no ?? '—'}</span>
              <span className="text-slate-600">{sale.customer_name || 'Walk-in'}</span>
              <span className="text-slate-500">{sale.business_date_bs}</span>
              <span>{formatNpr(sale.total)}</span>
            </button>
            {expandedId === sale.id ? (
              <ExchangeEditor
                sale={sale}
                onRecorded={() => {
                  setStatusMessage('Exchange recorded.');
                  setExpandedId(null);
                  void queryClient.invalidateQueries({ queryKey: ['exchange', 'sales'] });
                }}
              />
            ) : null}
          </div>
        ))}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Page {meta.page} of {meta.total_pages} ({meta.count} sales)
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
