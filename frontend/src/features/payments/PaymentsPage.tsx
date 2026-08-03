import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import type { Customer } from '@/features/billing/api';
import { demoConfig, listPayments, recordReceipt, searchCustomers } from '@/features/payments/api';
import { CashSessionPanel } from '@/features/payments/CashSessionPanel';
import type { ReceiptMethod } from '@/features/payments/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

const METHODS: ReceiptMethod[] = ['CASH', 'ESEWA', 'KHALTI', 'FONEPAY', 'CARD', 'BANK'];

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function CustomerField({
  customer,
  search,
  onSearch,
  onSelect,
  onClear,
}: {
  customer: Customer | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (value: Customer) => void;
  onClear: () => void;
}) {
  const query = useQuery({
    queryKey: ['payments', 'customers', search],
    queryFn: () => searchCustomers(search),
    enabled: search.trim().length >= 2 && !customer,
    staleTime: 30_000,
  });

  if (customer) {
    return (
      <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
        <span className="text-sm">
          <strong>{customer.name}</strong> <span className="text-slate-500">{customer.phone}</span>
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={onClear}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Input
        label="Customer"
        aria-label="Search customer for receipt"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search by name or phone…"
        autoComplete="off"
      />
      {query.isFetching ? <p className="mt-1 text-xs text-slate-500">Searching…</p> : null}
      {query.data && query.data.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {query.data.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => onSelect(result)}
              >
                <span className="font-medium">{result.name}</span>
                <span className="text-slate-500">{result.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReceiptForm({ onRecorded }: { onRecorded: () => void }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('CASH');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (!demoConfig.branchId || !customer || !amount.trim()) {
        throw new Error('Branch, customer, and amount are required.');
      }
      return recordReceipt({
        branch: demoConfig.branchId,
        customer: customer.id,
        amount: amount.trim(),
        method,
        ref_no: refNo.trim(),
        note: note.trim(),
      });
    },
    onSuccess: () => {
      setCustomer(null);
      setSearch('');
      setAmount('');
      setRefNo('');
      setNote('');
      setError(null);
      onRecorded();
    },
    onError: (err) => setError(message(err, 'Could not record the receipt.')),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demoConfig.branchId) {
      setError('Set VITE_DEMO_BRANCH_ID before recording receipts.');
      return;
    }
    if (!customer || !amount.trim()) {
      setError('Customer and amount are required.');
      return;
    }
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <CustomerField
          customer={customer}
          search={search}
          onSearch={setSearch}
          onSelect={(value) => {
            setCustomer(value);
            setSearch('');
          }}
          onClear={() => setCustomer(null)}
        />
      </div>
      <Input
        label="Amount (NPR)"
        type="number"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="receipt-method" className="text-sm font-medium text-slate-700">
          Method
        </label>
        <select
          id="receipt-method"
          value={method}
          onChange={(event) => setMethod(event.target.value as ReceiptMethod)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {METHODS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <Input
        label="Reference no."
        value={refNo}
        onChange={(event) => setRefNo(event.target.value)}
      />
      <Input label="Note" value={note} onChange={(event) => setNote(event.target.value)} />
      {error ? (
        <p role="alert" className="sm:col-span-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Record receipt'}
        </Button>
      </div>
    </form>
  );
}

/** Customer khata collection and append-only payment history. */
export function PaymentsPage() {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<ReceiptMethod | ''>('');
  const [page, setPage] = useState(1);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const paymentsQuery = useQuery({
    queryKey: ['payments', 'list', method, page],
    queryFn: () => listPayments({ direction: 'RECEIPT', method: method || undefined, page }),
  });
  const payments = paymentsQuery.data?.data ?? [];
  const meta = paymentsQuery.data?.meta ?? null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      {statusMessage ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {statusMessage}
        </p>
      ) : null}
      <CashSessionPanel />
      <Card title="Collect customer receipt / उधारो उठाउने">
        <ReceiptForm
          onRecorded={() => {
            setStatusMessage('Receipt recorded.');
            void queryClient.invalidateQueries({ queryKey: ['payments', 'list'] });
          }}
        />
      </Card>
      <Card title="Payment history / भुक्तानी इतिहास">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="payment-method-filter" className="text-sm font-medium text-slate-700">
              Filter by method
            </label>
            <select
              id="payment-method-filter"
              value={method}
              onChange={(event) => {
                setMethod(event.target.value as ReceiptMethod | '');
                setPage(1);
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All methods</option>
              {METHODS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        {paymentsQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {paymentsQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {message(paymentsQuery.error, 'Failed to load payment history.')}
          </p>
        ) : null}
        {paymentsQuery.data && payments.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No customer receipts yet.</p>
        ) : null}
        {payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2 font-medium">BS date</th>
                  <th className="py-2 pr-2 font-medium">Customer</th>
                  <th className="py-2 pr-2 font-medium">Method</th>
                  <th className="py-2 pr-2 font-medium">Note</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-slate-100">
                    <td className="whitespace-nowrap py-2 pr-2">{payment.business_date_bs}</td>
                    <td className="py-2 pr-2 font-medium">{payment.customer_name || '—'}</td>
                    <td className="py-2 pr-2">{payment.method}</td>
                    <td className="py-2 pr-2 text-slate-600">{payment.note || '—'}</td>
                    <td className="py-2 text-right font-semibold">{formatNpr(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Page {meta.page} of {meta.total_pages} ({meta.count} receipts)
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
