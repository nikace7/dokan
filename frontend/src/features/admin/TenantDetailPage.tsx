import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getTenant, listPlans, listUsage, updateTenant } from '@/features/admin/api';
import type { TenantStatus } from '@/features/admin/api';
import { FeatureTogglesPanel } from '@/features/admin/FeatureTogglesPanel';
import { SupportAccessPanel } from '@/features/admin/SupportAccessPanel';
import { TenantBillingPanel } from '@/features/admin/TenantBillingPanel';
import { TenantOverridesPanel } from '@/features/admin/TenantOverridesPanel';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';
import { ApiError } from '@/lib/api/client';

const STATUSES: readonly TenantStatus[] = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'];

export function TenantDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = usePlatformAuth();
  const queryClient = useQueryClient();
  const tenant = useQuery({
    queryKey: ['platform', 'tenants', id],
    queryFn: () => getTenant(id),
    enabled: Boolean(id),
  });
  const usage = useQuery({
    queryKey: ['platform', 'tenants', id, 'usage'],
    queryFn: () => listUsage(id),
    enabled: Boolean(id),
  });
  const plans = useQuery({
    queryKey: ['platform', 'plans', true],
    queryFn: () => listPlans(true),
    enabled: user?.role === 'SUPER_ADMIN',
  });
  const [status, setStatus] = useState<TenantStatus | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      updateTenant(id, { status: status ?? tenant.data?.status, plan: plan ?? tenant.data?.plan }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants', id] });
      setStatus(null);
      setPlan(null);
    },
  });

  if (tenant.isPending) return <main className="p-4 text-sm text-slate-500">Loading tenant…</main>;
  if (tenant.isError || !tenant.data)
    return (
      <main className="p-4">
        <p role="alert" className="text-sm text-red-700">
          {tenant.error instanceof Error ? tenant.error.message : 'Tenant not found.'}
        </p>
      </main>
    );
  const current = tenant.data;
  const latestUsage = usage.data?.data[0];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <div>
        <Link className="text-sm text-blue-700 hover:underline" to="/admin/tenants">
          ← All tenants
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{current.name}</h1>
        <p className="text-sm text-slate-500">
          {current.slug} · {current.plan_name} · {current.status}
        </p>
      </div>
      <Card title="Tenant profile">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Subdomain</dt>
            <dd>{current.slug}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Plan</dt>
            <dd>{current.plan_name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Calendar</dt>
            <dd>{current.calendar_pref}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Locale</dt>
            <dd>{current.locale}</dd>
          </div>
        </dl>
        {user?.role === 'SUPER_ADMIN' ? (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Status
              <select
                value={status ?? current.status}
                onChange={(event) => setStatus(event.target.value as TenantStatus)}
                className="rounded border border-slate-300 px-3 py-2 font-normal"
              >
                {STATUSES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Plan
              <select
                value={plan ?? current.plan}
                onChange={(event) => setPlan(event.target.value)}
                className="rounded border border-slate-300 px-3 py-2 font-normal"
              >
                {plans.data?.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.is_active ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={save.isPending || (status === null && plan === null)}
              onClick={() => save.mutate()}
            >
              Save lifecycle
            </Button>
            {save.isError ? (
              <p role="alert" className="text-sm text-red-700">
                {save.error instanceof ApiError ? save.error.message : 'Could not update tenant.'}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
      <Card title="Latest usage">
        {latestUsage ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-5">
            <Metric label="Users" value={latestUsage.users} />
            <Metric label="Items" value={latestUsage.items} />
            <Metric label="Invoices MTD" value={latestUsage.invoices_mtd} />
            <Metric label="Storage MB" value={latestUsage.storage_mb} />
            <Metric label="SMS used" value={latestUsage.sms_used} />
          </dl>
        ) : (
          <p className="text-sm text-slate-500">No reconciled usage snapshot yet.</p>
        )}
      </Card>
      {user ? <TenantBillingPanel tenantId={id} role={user.role} /> : null}
      {user ? (
        <FeatureTogglesPanel tenantId={id} planId={current.plan} canWrite={user.role === 'SUPER_ADMIN'} />
      ) : null}
      {user ? (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
            Advanced: raw overrides
          </summary>
          <div className="mt-2">
            <TenantOverridesPanel tenantId={id} canWrite={user.role === 'SUPER_ADMIN'} />
          </div>
        </details>
      ) : null}
      {user?.role === 'SUPER_ADMIN' || user?.role === 'SUPPORT' ? (
        <SupportAccessPanel tenantId={id} slug={current.slug} role={user.role} />
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}
