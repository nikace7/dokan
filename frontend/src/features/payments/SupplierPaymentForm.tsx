import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { listSuppliers } from '@/features/purchasing/api';
import type { Supplier } from '@/features/purchasing/api';
import { recordSupplierPayment } from '@/features/payments/api';
import { InvoiceAllocationPicker } from '@/features/payments/InvoiceAllocationPicker';
import type { ReceiptMethod } from '@/features/payments/api';
import { ApiError } from '@/lib/api/client';
import { useWorkspace } from '@/features/settings/useWorkspace';

const METHODS: ReceiptMethod[] = ['CASH', 'ESEWA', 'KHALTI', 'FONEPAY', 'CARD', 'BANK'];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
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
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['payments', 'suppliers', search],
    queryFn: () => listSuppliers(search),
    enabled: search.trim().length >= 2 && !supplier,
    staleTime: 30_000,
  });
  const suppliers = (query.data?.data ?? []).filter((item) => item.is_active);

  if (supplier) {
    return (
      <div className="flex items-center justify-between rounded-md border border-primary/30 bg-accent px-3 py-2">
        <span className="text-sm">
          <strong>{supplier.name}</strong>{' '}
          <span className="text-muted-foreground">{supplier.phone || t('common.noPhone')}</span>
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={onClear}>
          {t('common.change')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Input
        label={t('payments.supplier')}
        aria-label={t('payments.supplierSearchAria')}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={t('payments.supplierSearchPlaceholder')}
        autoComplete="off"
      />
      {query.isFetching ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('common.searching')}</p>
      ) : null}
      {suppliers.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-popover">
          {suppliers.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => onSelect(result)}
              >
                <span className="font-medium">{result.name}</span>
                <span className="text-muted-foreground">{result.phone || '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SupplierPaymentForm({ onRecorded }: { onRecorded: () => void }) {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('CASH');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      if (!workspace.branchId || !supplier || !amount.trim()) {
        throw new Error(t('payments.supplierRequiredFull'));
      }
      return recordSupplierPayment({
        branch: workspace.branchId,
        supplier: supplier.id,
        amount: amount.trim(),
        method,
        ref_no: refNo.trim(),
        note: note.trim(),
        allocations: Object.entries(allocations)
          .filter(([, value]) => value.trim())
          .map(([invoice, value]) => ({ invoice, amount: value.trim() })),
      });
    },
    onSuccess: () => {
      setSupplier(null);
      setSearch('');
      setAmount('');
      setRefNo('');
      setNote('');
      setAllocations({});
      setError(null);
      onRecorded();
    },
    onError: (err) => setError(errorMessage(err, t('payments.supplierSaveError'))),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.branchId) {
      setError(t('payments.supplierBranch'));
      return;
    }
    if (!supplier || !amount.trim()) {
      setError(t('payments.supplierRequired'));
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
            setAllocations({});
          }}
          onClear={() => {
            setSupplier(null);
            setAllocations({});
          }}
        />
      </div>
      {supplier ? (
        <InvoiceAllocationPicker
          party="supplier"
          partyId={supplier.id}
          values={allocations}
          onChange={setAllocations}
        />
      ) : null}
      <Input
        label={t('common.amountNpr')}
        type="number"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="supplier-payment-method">{t('common.method')}</Label>
        <select
          id="supplier-payment-method"
          value={method}
          onChange={(event) => setMethod(event.target.value as ReceiptMethod)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {METHODS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <Input
        label={t('payments.referenceNo')}
        value={refNo}
        onChange={(event) => setRefNo(event.target.value)}
      />
      <Input
        label={t('common.note')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.saving') : t('payments.recordSupplierPayment')}
        </Button>
      </div>
    </form>
  );
}
