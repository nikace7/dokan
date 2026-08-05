import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  createSubscription,
  listPlans,
  listSubscriptions,
  updateSubscription,
} from '@/features/admin/api';
import type { PlatformRole, Subscription } from '@/features/admin/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

export function TenantBillingPanel({ tenantId, role }: { tenantId: string; role: PlatformRole }) {
  const canWrite = role === 'SUPER_ADMIN' || role === 'BILLING';
  const subscriptions = useQuery({
    queryKey: ['platform', 'tenants', tenantId, 'subscriptions'],
    queryFn: () => listSubscriptions(tenantId),
  });
  const plans = useQuery({
    queryKey: ['platform', 'plans', true],
    queryFn: () => listPlans(true),
    enabled: canWrite,
  });

  return (
    <Card title="Subscriptions">
      {canWrite ? <SubscriptionForm tenantId={tenantId} plans={plans.data?.data ?? []} /> : null}
      {subscriptions.isError ? (
        <p role="alert" className="text-sm text-red-700">
          {subscriptions.error instanceof Error
            ? subscriptions.error.message
            : 'Could not load subscriptions.'}
        </p>
      ) : null}
      {subscriptions.data?.data.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">No subscription periods recorded.</p>
      ) : null}
      {subscriptions.data?.data.length ? (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500">
              <th className="py-2">Period</th>
              <th className="py-2">Plan</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.data.data.map((row) => (
              <SubscriptionRow key={row.id} tenantId={tenantId} row={row} canWrite={canWrite} />
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
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
  const [status, setStatus] = useState(row.status);
  const mutation = useMutation({
    mutationFn: () =>
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
    <tr className="border-b border-slate-100">
      <td className="py-2">
        {row.period_start} – {row.period_end}
      </td>
      <td className="py-2">{row.plan_code}</td>
      <td className="py-2 text-right">{formatNpr(row.amount_npr)}</td>
      <td className="py-2">
        {canWrite ? (
          <div className="flex gap-2">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as Subscription['status'])}
              aria-label={`Status for ${row.period_start}`}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option>PENDING</option>
              <option>PAID</option>
              <option>FAILED</option>
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={mutation.isPending || status === row.status}
              onClick={() => mutation.mutate()}
            >
              Save
            </Button>
          </div>
        ) : (
          row.status
        )}
      </td>
    </tr>
  );
}

function SubscriptionForm({
  tenantId,
  plans,
}: {
  tenantId: string;
  plans: Array<{ id: string; name: string }>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [amount, setAmount] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      createSubscription(tenantId, {
        plan,
        period_start: periodStart,
        period_end: periodEnd,
        amount_npr: amount,
        status: 'PENDING',
        payment_ref: null,
        invoice_url: null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['platform', 'tenants', tenantId, 'subscriptions'],
      });
      setOpen(false);
    },
  });
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Add subscription period
      </Button>
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Plan
        <select
          required
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          className="rounded border border-slate-300 px-2 py-2 font-normal"
        >
          <option value="">Select</option>
          {plans.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
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
      {mutation.isError ? (
        <p role="alert" className="text-sm text-red-700 sm:col-span-4">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : 'Could not add subscription.'}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" disabled={mutation.isPending}>
          Save period
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
