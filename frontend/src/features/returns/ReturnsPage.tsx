import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { createReturn, getReturnableLines, listSales } from '@/features/returns/api';
import type { RefundMethod, ReturnableLine, SaleSummary } from '@/features/returns/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

const REFUND_METHODS: RefundMethod[] = [
  'CREDIT_NOTE',
  'CASH',
  'ESEWA',
  'KHALTI',
  'FONEPAY',
  'CARD',
  'BANK',
];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function ReturnEditor({ sale, onRecorded }: { sale: SaleSummary; onRecorded: () => void }) {
  const linesQuery = useQuery({
    queryKey: ['returns', 'returnable', sale.id],
    queryFn: () => getReturnableLines(sale.id),
  });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('CREDIT_NOTE');
  const [refundAmount, setRefundAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const lines = (linesQuery.data ?? [])
        .map((line) => ({ variant: line.variant, qty: quantities[line.variant] ?? '' }))
        .filter((line) => line.qty.trim() !== '');
      return createReturn({
        original_invoice: sale.id,
        lines,
        reason: reason.trim(),
        refunds: refundAmount.trim()
          ? [{ method: refundMethod, amount: refundAmount.trim() }]
          : undefined,
      });
    },
    onSuccess: onRecorded,
    onError: (err) => setError(errorMessage(err, 'Could not record the return.')),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hasLine = Object.values(quantities).some((qty) => qty.trim() !== '');
    if (!hasLine || !reason.trim()) {
      setError('Select a return quantity and enter a reason.');
      return;
    }
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} className="border-t border-border px-2 py-3">
      {linesQuery.isFetching ? (
        <p className="text-sm text-muted-foreground">Loading returnable lines…</p>
      ) : null}
      {linesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(linesQuery.error, 'Could not load returnable lines.')}
        </p>
      ) : null}
      {linesQuery.data && linesQuery.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          All lines on this bill have already been returned.
        </p>
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
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`refund-method-${sale.id}`}>Refund method (optional)</Label>
              <select
                id={`refund-method-${sale.id}`}
                value={refundMethod}
                onChange={(event) => setRefundMethod(event.target.value as RefundMethod)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {REFUND_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Refund amount (NPR, optional)"
              type="number"
              min="0.01"
              step="0.01"
              value={refundAmount}
              onChange={(event) => setRefundAmount(event.target.value)}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The server calculates the return credit from the original bill and validates any refund.
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="mt-3" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Record return'}
          </Button>
        </>
      ) : null}
    </form>
  );
}

function ReturnLineField({
  line,
  value,
  onChange,
}: {
  line: ReturnableLine;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{line.item_name}</span>{' '}
        <span className="text-xs text-muted-foreground">{line.sku}</span>
        <span className="block text-xs text-muted-foreground">Remaining: {line.remaining}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Return qty</span>
        <input
          aria-label={`Return quantity for ${line.item_name}`}
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

/** Return completed sale lines as immutable credit-note documents. */
export function ReturnsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const salesQuery = useQuery({
    queryKey: ['returns', 'sales', page],
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
      <Card title="Returns / फिर्ता">
        <p className="mb-3 text-sm text-muted-foreground">
          Select a completed sale, choose the returned quantities, and record the reason.
        </p>
        {salesQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">Loading sales…</p>
        ) : null}
        {salesQuery.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage(salesQuery.error, 'Could not load completed sales.')}
          </p>
        ) : null}
        {salesQuery.data && sales.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No completed sales found.
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
              <span className="font-medium">Invoice {sale.invoice_no ?? '—'}</span>
              <span className="text-muted-foreground">{sale.customer_name || 'Walk-in'}</span>
              <span className="text-muted-foreground">{sale.business_date_bs}</span>
              <span className="tabular-nums">{formatNpr(sale.total)}</span>
            </button>
            {expandedId === sale.id ? (
              <ReturnEditor
                sale={sale}
                onRecorded={() => {
                  setStatusMessage('Return recorded.');
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
