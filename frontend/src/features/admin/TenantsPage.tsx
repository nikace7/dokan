import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { createTenant, listPlans, listTenants } from '@/features/admin/api';
import type { Plan, TenantCreatePayload, TenantStatus } from '@/features/admin/api';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';
import { ApiError } from '@/lib/api/client';

const STATUSES: readonly TenantStatus[] = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'];

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Could not complete the request.';
}

export function TenantsPage() {
  const { user } = usePlatformAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const plans = useQuery({
    queryKey: ['platform', 'plans', true],
    queryFn: () => listPlans(true),
  });
  const tenants = useQuery({
    queryKey: ['platform', 'tenants', search, status, page],
    queryFn: () => listTenants({ search: search.trim(), status, page }),
  });

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Card
        title="Tenants"
        actions={
          user?.role === 'SUPER_ADMIN' ? (
            <Button size="sm" onClick={() => setCreating((value) => !value)}>
              New tenant
            </Button>
          ) : null
        }
      >
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            aria-label="Search tenants"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Shop name or subdomain"
            className="min-w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            aria-label="Tenant status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>

        {creating && user?.role === 'SUPER_ADMIN' ? (
          <NewTenantForm plans={plans.data?.data ?? []} onDone={() => setCreating(false)} />
        ) : null}

        {tenants.isPending ? <p className="py-4 text-sm text-slate-500">Loading tenants…</p> : null}
        {tenants.isError ? (
          <p role="alert" className="py-4 text-sm text-red-700">
            {errorMessage(tenants.error)}
          </p>
        ) : null}
        {tenants.data?.data.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No tenants match.</p>
        ) : null}
        {tenants.data?.data.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-2 font-medium">Shop</th>
                <th className="py-2 font-medium">Subdomain</th>
                <th className="py-2 font-medium">Plan</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Trial ends</th>
              </tr>
            </thead>
            <tbody>
              {tenants.data.data.map((tenant) => (
                <tr key={tenant.id} className="border-b border-slate-100">
                  <td className="py-2 font-medium">
                    <Link
                      className="text-blue-700 hover:underline"
                      to={`/admin/tenants/${tenant.id}`}
                    >
                      {tenant.name}
                    </Link>
                  </td>
                  <td className="py-2">{tenant.slug}</td>
                  <td className="py-2">{tenant.plan_name}</td>
                  <td className="py-2">
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium">
                      {tenant.status}
                    </span>
                  </td>
                  <td className="py-2">
                    {tenant.trial_ends_at
                      ? new Date(tenant.trial_ends_at).toLocaleDateString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {tenants.data?.meta && tenants.data.meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span>
              Page {tenants.data.meta.page} of {tenants.data.meta.total_pages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= tenants.data.meta.total_pages}
                onClick={() => setPage(page + 1)}
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

function emptyTenant(plan = ''): TenantCreatePayload {
  return {
    slug: '',
    name: '',
    plan,
    status: 'ACTIVE',
    owner_phone: '',
    owner_full_name: '',
    owner_email: null,
    owner_password: '',
    branch_code: 'MAIN',
    branch_name: 'Main Branch',
  };
}

function NewTenantForm({ plans, onDone }: { plans: Plan[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => emptyTenant(plans.find((plan) => plan.is_active)?.id));
  const mutation = useMutation({
    mutationFn: createTenant,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({
      ...form,
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      owner_phone: form.owner_phone.trim(),
      owner_full_name: form.owner_full_name.trim(),
      owner_email: form.owner_email?.trim() || null,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mb-6 grid gap-3 rounded-md border border-blue-200 bg-blue-50 p-4 sm:grid-cols-2"
    >
      <h3 className="font-semibold sm:col-span-2">Provision tenant, owner and default branch</h3>
      <Input
        label="Shop name"
        required
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />
      <Input
        label="Subdomain"
        required
        pattern="[a-z0-9-]{3,30}"
        value={form.slug}
        onChange={(event) => setForm({ ...form, slug: event.target.value })}
      />
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Plan
        <select
          required
          value={form.plan}
          onChange={(event) => setForm({ ...form, plan: event.target.value })}
          className="rounded-md border border-slate-300 px-3 py-2 font-normal"
        >
          <option value="">Select a plan</option>
          {plans
            .filter((plan) => plan.is_active)
            .map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Status
        <select
          value={form.status}
          onChange={(event) => setForm({ ...form, status: event.target.value as TenantStatus })}
          className="rounded-md border border-slate-300 px-3 py-2 font-normal"
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="TRIAL">TRIAL</option>
        </select>
      </label>
      <Input
        label="Owner name"
        required
        value={form.owner_full_name}
        onChange={(event) => setForm({ ...form, owner_full_name: event.target.value })}
      />
      <Input
        label="Owner phone"
        required
        value={form.owner_phone}
        onChange={(event) => setForm({ ...form, owner_phone: event.target.value })}
      />
      <Input
        label="Owner email"
        type="email"
        value={form.owner_email ?? ''}
        onChange={(event) => setForm({ ...form, owner_email: event.target.value })}
      />
      <Input
        label="Temporary owner password"
        type="password"
        minLength={12}
        required
        value={form.owner_password}
        onChange={(event) => setForm({ ...form, owner_password: event.target.value })}
      />
      {mutation.isError ? (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending || !form.plan}>
          {mutation.isPending ? 'Provisioning…' : 'Provision tenant'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
