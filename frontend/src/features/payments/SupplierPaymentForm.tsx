import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { listSuppliers } from '@/features/purchasing/api';
import type { Supplier } from '@/features/purchasing/api';
import { demoConfig, recordSupplierPayment } from '@/features/payments/api';
import type { ReceiptMethod } from '@/features/payments/api';
import { ApiError } from '@/lib/api/client';

const METHODS: ReceiptMethod[] = ['CASH', 'ESEWA', 'KHALTI', 'FONEPAY', 'CARD', 'BANK'];

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Could not record the supplier payment.';
}

function SupplierField({
  supplier,
  search,
  onSearch,
  onSelect,
  onClear,
}: {
  supplier: Supplier | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (value: Supplier) => void;
  onClear: () => void;
}) {
  const query = useQuery({
    queryKey: ['payments', 'suppliers', search],
    queryFn: () => listSuppliers(search),
    enabled: search.trim().length >= 2 && !supplier,
    staleTime: 30_000,
  });
  const suppliers = (query.data?.data ?? []).filter((item) => item.is_active);

  if (supplier) {
    return (
      <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
        <span className="text-sm">
          <strong>{supplier.name}</strong>{' '}
          <span className="text-slate-500">{supplier.phone || 'No phone'}</span>
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
        label="Supplier"
        aria-label="Search supplier for payment"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search supplier by name…"
        autoComplete="off"
      />
      {query.isFetching ? <p className="mt-1 text-xs text-slate-500">Searching…</p> : null}
      {suppliers.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {suppliers.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => onSelect(result)}
              >
                <span className="font-medium">{result.name}</span>
                <span className="text-slate-500">{result.phone || '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SupplierPaymentForm({ onRecorded }: { onRecorded: () => void }) {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('CASH');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      if (!demoConfig.branchId || !supplier || !amount.trim()) {
        throw new Error('Branch, supplier, and amount are required.');
      }
      return recordSupplierPayment({
        branch: demoConfig.branchId,
        supplier: supplier.id,
        amount: amount.trim(),
        method,
        ref_no: refNo.trim(),
        note: note.trim(),
      });
    },
    onSuccess: () => {
      setSupplier(null);
      setSearch('');
      setAmount('');
      setRefNo('');
      setNote('');
      setError(null);
      onRecorded();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demoConfig.branchId) {
      setError('Set VITE_DEMO_BRANCH_ID before recording payments.');
      return;
    }
    if (!supplier || !amount.trim()) {
      setError('Supplier and amount are required.');
      return;
    }
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <SupplierField
          supplier={supplier}
          search={search}
          onSearch={setSearch}
          onSelect={(value) => {
            setSupplier(value);
            setSearch('');
          }}
          onClear={() => setSupplier(null)}
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
        <label htmlFor="supplier-payment-method" className="text-sm font-medium text-slate-700">
          Method
        </label>
        <select
          id="supplier-payment-method"
          value={method}
          onChange={(event) => setMethod(event.target.value as ReceiptMethod)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
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
          {mutation.isPending ? 'Saving…' : 'Record supplier payment'}
        </Button>
      </div>
    </form>
  );
}
