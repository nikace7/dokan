import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { createPlan, listPlans, updatePlan } from '@/features/admin/api';
import type { Plan, PlanPayload } from '@/features/admin/api';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

function entries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

export function PlansPage() {
  const { user } = usePlatformAuth();
  const plans = useQuery({
    queryKey: ['platform', 'plans', true],
    queryFn: () => listPlans(true),
  });
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const canWrite = user?.role === 'SUPER_ADMIN';

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Card
        title="Plans"
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              New plan
            </Button>
          ) : null
        }
      >
        {editing && canWrite ? (
          <PlanForm
            plan={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
        {plans.isPending ? <p className="py-4 text-sm text-slate-500">Loading plans…</p> : null}
        <div className="grid gap-4 md:grid-cols-2">
          {plans.data?.data.map((plan) => (
            <section key={plan.id} className="rounded-md border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{plan.name}</h3>
                  <p className="text-xs text-slate-500">
                    {plan.code} · {plan.billing_cycle}
                  </p>
                </div>
                {canWrite ? (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(plan)}>
                    Edit
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-lg font-semibold">{formatNpr(plan.price_npr)}</p>
              {!plan.is_active ? (
                <p className="text-xs font-medium text-red-700">Inactive</p>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <ConfigList title="Limits" values={plan.limits} />
                <ConfigList title="Features" values={plan.features} />
              </div>
            </section>
          ))}
        </div>
      </Card>
    </main>
  );
}

function ConfigList({ title, values }: { title: string; values: Record<string, unknown> }) {
  return (
    <div>
      <h4 className="font-semibold text-slate-600">{title}</h4>
      <dl>
        {entries(values).map(([key, value]) => (
          <div key={key} className="flex justify-between gap-2">
            <dt className="font-mono">{key}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function defaultPlan(): PlanPayload {
  return {
    code: '',
    name: '',
    price_npr: '0.00',
    billing_cycle: 'monthly',
    limits: {},
    features: {},
    is_active: true,
    sort_order: 0,
  };
}

function PlanForm({ plan, onDone }: { plan?: Plan; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlanPayload>(() =>
    plan
      ? {
          code: plan.code,
          name: plan.name,
          price_npr: plan.price_npr,
          billing_cycle: plan.billing_cycle,
          limits: plan.limits,
          features: plan.features,
          is_active: plan.is_active,
          sort_order: plan.sort_order,
        }
      : defaultPlan(),
  );
  const [limits, setLimits] = useState(() => JSON.stringify(form.limits, null, 2));
  const [features, setFeatures] = useState(() => JSON.stringify(form.features, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  useEffect(() => {
    setJsonError(null);
  }, [limits, features]);
  const mutation = useMutation({
    mutationFn: (payload: PlanPayload) =>
      plan ? updatePlan(plan.id, payload) : createPlan(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const parsedLimits = JSON.parse(limits) as Record<string, unknown>;
      const parsedFeatures = JSON.parse(features) as Record<string, unknown>;
      mutation.mutate({
        ...form,
        code: form.code.trim().toLowerCase(),
        name: form.name.trim(),
        limits: parsedLimits,
        features: parsedFeatures,
      });
    } catch {
      setJsonError('Limits and features must be valid JSON objects.');
    }
  };
  return (
    <form
      onSubmit={submit}
      className="mb-5 grid gap-3 rounded-md border border-blue-200 bg-blue-50 p-4 sm:grid-cols-2"
    >
      <Input
        label="Code"
        required
        disabled={Boolean(plan)}
        value={form.code}
        onChange={(event) => setForm({ ...form, code: event.target.value })}
      />
      <Input
        label="Name"
        required
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />
      <Input
        label="Price (NPR)"
        required
        inputMode="decimal"
        value={form.price_npr}
        onChange={(event) => setForm({ ...form, price_npr: event.target.value })}
      />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Billing cycle
        <select
          value={form.billing_cycle}
          onChange={(event) =>
            setForm({ ...form, billing_cycle: event.target.value as PlanPayload['billing_cycle'] })
          }
          className="rounded border border-slate-300 px-3 py-2 font-normal"
        >
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Limits JSON
        <textarea
          rows={8}
          value={limits}
          onChange={(event) => setLimits(event.target.value)}
          className="rounded border border-slate-300 px-3 py-2 font-mono text-xs font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Features JSON
        <textarea
          rows={8}
          value={features}
          onChange={(event) => setFeatures(event.target.value)}
          className="rounded border border-slate-300 px-3 py-2 font-mono text-xs font-normal"
        />
      </label>
      <Input
        label="Sort order"
        type="number"
        value={form.sort_order}
        onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) })}
      />
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
        />{' '}
        Active
      </label>
      {jsonError || mutation.isError ? (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {jsonError ??
            (mutation.error instanceof ApiError ? mutation.error.message : 'Could not save plan.')}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {plan ? 'Save plan' : 'Create plan'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
