import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import type { BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createSubscription,
  getTenant,
  listPlans,
  listSubscriptions,
  updateSubscription,
} from '@/features/admin/api';
import type { PlatformRole, Subscription } from '@/features/admin/api';
import { AdminCard, EmptyState, Field, LoadingRows } from '@/features/admin/components';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

const SUB_STATUS_VARIANT: Record<Subscription['status'], BadgeProps['variant']> = {
  PENDING: 'warning',
  PAID: 'success',
  FAILED: 'destructive',
};

const selectClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function TenantBillingPanel({ tenantId, role }: { tenantId: string; role: PlatformRole }) {
  const canWrite = role === 'SUPER_ADMIN' || role === 'BILLING';
  const [recording, setRecording] = useState(false);
  const tenant = useQuery({
    queryKey: ['platform', 'tenants', tenantId],
    queryFn: () => getTenant(tenantId),
  });
  const subscriptions = useQuery({
    queryKey: ['platform', 'tenants', tenantId, 'subscriptions'],
    queryFn: () => listSubscriptions(tenantId),
  });

  return (
    <AdminCard
      title="Plan & billing"
      description="The plan controls what the shop can do; subscription rows are the billing record for each period."
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setRecording(true)}>
            Record subscription
          </Button>
        ) : null
      }
    >
      <p className="text-sm text-muted-foreground">
        Current plan:{' '}
        <span className="font-medium text-foreground">
          {tenant.data ? `${tenant.data.plan_name} (${tenant.data.plan_code})` : '…'}
        </span>
        . Switch plans from the tenant profile above; use the form here for custom terms — any
        period and amount.
      </p>

      {subscriptions.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {subscriptions.error instanceof Error
            ? subscriptions.error.message
            : 'Could not load subscriptions.'}
        </p>
      ) : null}
      {subscriptions.data?.data.length === 0 ? (
        <EmptyState
          className="mt-3"
          title="No subscription periods recorded"
          body="Record the first period to start the billing history."
        />
      ) : null}
      {subscriptions.data?.data.length || subscriptions.isPending ? (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.isPending ? <LoadingRows columns={canWrite ? 5 : 4} /> : null}
            {subscriptions.data?.data.map((row) => (
              <SubscriptionRow key={row.id} tenantId={tenantId} row={row} canWrite={canWrite} />
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog open={recording} onOpenChange={setRecording}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record subscription</DialogTitle>
            <DialogDescription>
              Add a billing period for this shop. Custom terms: set any period and amount — this
              does not change the live plan.
            </DialogDescription>
          </DialogHeader>
          {recording ? (
            <SubscriptionForm tenantId={tenantId} onDone={() => setRecording(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </AdminCard>
  );
}

function SubscriptionRow({
  tenantId,
  row,
  canWrite,
}: {
  tenantId: string;
  row: Subscription;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: Subscription['status']) =>
      updateSubscription(tenantId, row.id, {
        status,
        payment_ref: row.payment_ref,
        invoice_url: row.invoice_url,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['platform', 'tenants', tenantId, 'subscriptions'],
      }),
  });
  return (
    <TableRow>
      <TableCell>
        {row.period_start} – {row.period_end}
      </TableCell>
      <TableCell>{row.plan_code}</TableCell>
      <TableCell className="text-right">{formatNpr(row.amount_npr)}</TableCell>
      <TableCell>
        <Badge variant={SUB_STATUS_VARIANT[row.status]}>{row.status}</Badge>
        {mutation.isError ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : 'Could not update.'}
          </p>
        ) : null}
      </TableCell>
      {canWrite ? (
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            {row.status !== 'PAID' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate('PAID')}
              >
                Mark paid
              </Button>
            ) : null}
            {row.status !== 'FAILED' ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate('FAILED')}
              >
                Mark failed
              </Button>
            ) : null}
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function SubscriptionForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const plans = useQuery({
    queryKey: ['platform', 'plans', true],
    queryFn: () => listPlans(true),
  });
  const [plan, setPlan] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<Subscription['status']>('PENDING');
  const [paymentRef, setPaymentRef] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      createSubscription(tenantId, {
        plan,
        period_start: periodStart,
        period_end: periodEnd,
        amount_npr: amount,
        status,
        payment_ref: paymentRef.trim() || null,
        invoice_url: invoiceUrl.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['platform', 'tenants', tenantId, 'subscriptions'],
      });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Plan" htmlFor="sub-plan">
        <select
          id="sub-plan"
          required
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          className={selectClass}
        >
          <option value="">Select a plan</option>
          {plans.data?.data.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status" htmlFor="sub-status">
        <select
          id="sub-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as Subscription['status'])}
          className={selectClass}
        >
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="FAILED">Failed</option>
        </select>
      </Field>
      <Input
        label="Period start"
        type="date"
        required
        value={periodStart}
        onChange={(event) => setPeriodStart(event.target.value)}
      />
      <Input
        label="Period end"
        type="date"
        required
        value={periodEnd}
        onChange={(event) => setPeriodEnd(event.target.value)}
      />
      <Input
        label="Amount (NPR)"
        required
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <Input
        label="Payment reference (optional)"
        value={paymentRef}
        onChange={(event) => setPaymentRef(event.target.value)}
      />
      <Input
        label="Invoice URL (optional)"
        type="url"
        value={invoiceUrl}
        onChange={(event) => setInvoiceUrl(event.target.value)}
        className="sm:col-span-2"
      />
      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : 'Could not record subscription.'}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending || !plan}>
          {mutation.isPending ? 'Saving…' : 'Save period'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
