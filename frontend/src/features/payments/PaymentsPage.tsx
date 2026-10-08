import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
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
import { useAuth } from '@/features/auth/useAuth';
import type { Customer } from '@/features/billing/api';
import { getCustomer, listPayments, recordReceipt } from '@/features/payments/api';
import type { Payment, ReceiptMethod } from '@/features/payments/api';
import { CashSessionPanel } from '@/features/payments/CashSessionPanel';
import { CustomerField } from '@/features/payments/CustomerField';
import { InvoiceAllocationPicker } from '@/features/payments/InvoiceAllocationPicker';
import { SupplierPaymentForm } from '@/features/payments/SupplierPaymentForm';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { ApiError } from '@/lib/api/client';
import { formatNpr, useMoneyDisplay } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';

const METHODS: ReceiptMethod[] = ['CASH', 'ESEWA', 'KHALTI', 'FONEPAY', 'CARD', 'BANK'];

const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function ReceiptForm({ onRecorded }: { onRecorded: () => void }) {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const [searchParams] = useSearchParams();
  const preselectId = searchParams.get('customer');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('CASH');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Deep link from the customers list (/payments?customer=<id>): fetch the party
  // once and preselect it. A bad id just leaves the form in its normal state.
  const preselectApplied = useRef(false);
  const preselect = useQuery({
    queryKey: ['customers', 'detail', preselectId],
    queryFn: () => getCustomer(preselectId!),
    enabled: Boolean(preselectId),
    retry: false,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (preselectApplied.current || !preselect.data) return;
    preselectApplied.current = true;
    if (!customer) setCustomer(preselect.data);
  }, [preselect.data, customer]);

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
            preselectApplied.current = true;
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
          {mutation.isPending ? t('common.saving') : t('payments.recordReceipt')}
        </Button>
      </div>
    </form>
  );
}

/** Payment history: card list below `md`, full table from `md` up. */
function PaymentList({ payments }: { payments: Payment[] }) {
  const { t } = useTranslation();
  useMoneyDisplay();
  return (
    <>
      <ul className="divide-y divide-border md:hidden">
        {payments.map((payment) => (
          <li key={payment.id} className="py-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{payment.customer_name || '—'}</span>
              <span className="font-semibold tabular-nums">{formatNpr(payment.amount)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
              <span>{payment.business_date_bs}</span>
              <Badge variant="outline">{payment.method}</Badge>
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
                <TableCell>
                  <Badge variant="outline">{payment.method}</Badge>
                </TableCell>
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

/**
 * Customer khata collection and append-only payment history. Each section is
 * shown only to roles that can use it (a cashier sees just the receipt form).
 */
export function PaymentsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canViewHistory = hasPermission(user, 'payment.view');
  const [method, setMethod] = useState<ReceiptMethod | ''>('');
  const [page, setPage] = useState(1);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const paymentsQuery = useQuery({
    queryKey: ['payments', 'list', method, page],
    queryFn: () => listPayments({ direction: 'RECEIPT', method: method || undefined, page }),
    enabled: canViewHistory,
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
      {hasPermission(user, 'cash.manage') ? <CashSessionPanel /> : null}
      {hasPermission(user, 'payment.receive') ? (
        <Card title={t('payments.receiptTitle')}>
          <ReceiptForm
            onRecorded={() => {
              setStatusMessage(t('payments.receiptRecorded'));
              void queryClient.invalidateQueries({ queryKey: ['payments', 'list'] });
            }}
          />
        </Card>
      ) : null}
      {hasPermission(user, 'payment.pay') ? (
        <Card title={t('payments.supplierTitle')}>
          <SupplierPaymentForm
            onRecorded={() => setStatusMessage(t('payments.supplierRecorded'))}
          />
        </Card>
      ) : null}
      {canViewHistory ? (
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
      ) : null}
    </main>
  );
}
