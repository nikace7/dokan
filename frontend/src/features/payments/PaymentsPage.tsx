import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Customer } from '@/features/billing/api';
import { listPayments, recordReceipt, searchCustomers } from '@/features/payments/api';
import { CashSessionPanel } from '@/features/payments/CashSessionPanel';
import { InvoiceAllocationPicker } from '@/features/payments/InvoiceAllocationPicker';
import { SupplierPaymentForm } from '@/features/payments/SupplierPaymentForm';
import type { Payment, ReceiptMethod } from '@/features/payments/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';
import { useWorkspace } from '@/features/settings/useWorkspace';

const METHODS: ReceiptMethod[] = ['CASH', 'ESEWA', 'KHALTI', 'FONEPAY', 'CARD', 'BANK'];

const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

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
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['payments', 'customers', search],
    queryFn: () => searchCustomers(search),
    enabled: search.trim().length >= 2 && !customer,
    staleTime: 30_000,
  });

  if (customer) {
    return (
      <div className="flex items-center justify-between rounded-md border border-primary/30 bg-accent px-3 py-2">
        <span className="text-sm">
          <strong>{customer.name}</strong>{' '}
          <span className="text-muted-foreground">{customer.phone}</span>
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
        label={t('payments.customer')}
        aria-label={t('payments.customerSearchAria')}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={t('common.searchByNameOrPhone')}
        autoComplete="off"
      />
      {query.isFetching ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('common.searching')}</p>
      ) : null}
      {query.data && query.data.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-popover">
          {query.data.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => onSelect(result)}
              >
                <span className="font-medium">{result.name}</span>
                <span className="text-muted-foreground">{result.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReceiptForm({ onRecorded }: { onRecorded: () => void }) {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('CASH');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (!workspace.branchId || !customer || !amount.trim()) {
        throw new Error(t('payments.receiptRequiredFull'));
      }
      return recordReceipt({
        branch: workspace.branchId,
        customer: customer.id,
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
      setCustomer(null);
      setSearch('');
      setAmount('');
      setRefNo('');
      setNote('');
      setAllocations({});
      setError(null);
      onRecorded();
    },
    onError: (err) => setError(message(err, t('payments.receiptSaveError'))),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.branchId) {
      setError(t('payments.receiptBranch'));
      return;
    }
    if (!customer || !amount.trim()) {
      setError(t('payments.receiptRequired'));
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
            setAllocations({});
          }}
          onClear={() => {
            setCustomer(null);
            setAllocations({});
          }}
        />
      </div>
      {customer ? (
        <InvoiceAllocationPicker
          party="customer"
          partyId={customer.id}
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
        <Label htmlFor="receipt-method">{t('common.method')}</Label>
        <select
          id="receipt-method"
          value={method}
          onChange={(event) => setMethod(event.target.value as ReceiptMethod)}
          className={selectClasses}
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
      <Input label={t('common.note')} value={note} onChange={(event) => setNote(event.target.value)} />
      {error ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.saving') : t('payments.recordReceipt')}
        </Button>
      </div>
    </form>
  );
}

/** Payment history: card list below `md`, full table from `md` up. */
function PaymentList({ payments }: { payments: Payment[] }) {
  const { t } = useTranslation();
  return (
    <>
      <ul className="divide-y divide-border md:hidden">
        {payments.map((payment) => (
          <li key={payment.id} className="py-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{payment.customer_name || '—'}</span>
              <span className="font-semibold tabular-nums">{formatNpr(payment.amount)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
              <span>{payment.business_date_bs}</span>
              <span>{payment.method}</span>
              <span>{payment.note || '—'}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('payments.bsDate')}</TableHead>
              <TableHead>{t('payments.customer')}</TableHead>
              <TableHead>{t('common.method')}</TableHead>
              <TableHead>{t('common.note')}</TableHead>
              <TableHead className="text-right">{t('payments.amount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell className="whitespace-nowrap">{payment.business_date_bs}</TableCell>
                <TableCell className="font-medium">{payment.customer_name || '—'}</TableCell>
                <TableCell>{payment.method}</TableCell>
                <TableCell className="text-muted-foreground">{payment.note || '—'}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatNpr(payment.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** Customer khata collection and append-only payment history. */
export function PaymentsPage() {
  const { t } = useTranslation();
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
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {statusMessage}
        </p>
      ) : null}
      <CashSessionPanel />
      <Card title={t('payments.receiptTitle')}>
        <ReceiptForm
          onRecorded={() => {
            setStatusMessage(t('payments.receiptRecorded'));
            void queryClient.invalidateQueries({ queryKey: ['payments', 'list'] });
          }}
        />
      </Card>
      <Card title={t('payments.supplierTitle')}>
        <SupplierPaymentForm onRecorded={() => setStatusMessage(t('payments.supplierRecorded'))} />
      </Card>
      <Card title={t('payments.historyTitle')}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-method-filter">{t('payments.filterByMethod')}</Label>
            <select
              id="payment-method-filter"
              value={method}
              onChange={(event) => {
                setMethod(event.target.value as ReceiptMethod | '');
                setPage(1);
              }}
              className={selectClasses}
            >
              <option value="">{t('payments.allMethods')}</option>
              {METHODS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        {paymentsQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {paymentsQuery.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {message(paymentsQuery.error, t('payments.historyLoadError'))}
          </p>
        ) : null}
        {paymentsQuery.data && payments.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('payments.historyEmpty')}
          </p>
        ) : null}
        {payments.length > 0 ? <PaymentList payments={payments} /> : null}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('common.pageOf', { page: meta.page, total: meta.total_pages })} (
              {t('payments.historyCount', { count: meta.count })})
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
