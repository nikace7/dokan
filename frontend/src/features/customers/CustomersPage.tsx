import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/features/auth/useAuth';
import {
  createCustomer,
  deactivateCustomer,
  listCustomers,
  updateCustomer,
} from '@/features/customers/api';
import type { Customer, CustomerPayload } from '@/features/customers/api';
import { listPricingRateTypes } from '@/features/pricing/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';

type StatusFilter = 'active' | 'inactive' | 'all';

export function CustomersPage() {
  const { user, isRestoring } = useAuth();
  const canView = hasPermission(user, 'customer.view');
  const canManage = hasPermission(user, 'customer.manage');
  const canSetCredit = hasPermission(user, 'customer.credit');
  const canViewPricing = hasPermission(user, 'pricing.view');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);

  const customers = useQuery({
    queryKey: ['customers', 'list', search.trim(), status, page],
    queryFn: () =>
      listCustomers({
        search: search.trim() || undefined,
        isActive: status === 'all' ? undefined : status === 'active',
        page,
      }),
    enabled: canView,
  });
  const rates = useQuery({
    queryKey: ['pricing', 'rate-types'],
    queryFn: () => listPricingRateTypes(true),
    enabled: canViewPricing && canManage,
    staleTime: 5 * 60_000,
  });
  const deactivate = useMutation({
    mutationFn: deactivateCustomer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });

  if (isRestoring) return <main className="p-6 text-sm text-slate-500">Loading customers…</main>;
  if (!canView) {
    return <main className="p-6 text-sm text-amber-800">You cannot view customers.</main>;
  }

  return (
    <main className="mx-auto max-w-6xl p-4">
      <Card
        title="Customers / ग्राहक"
        actions={canManage ? <Button onClick={() => setEditing('new')}>New customer</Button> : null}
      >
        {editing && canManage ? (
          <CustomerForm
            customer={editing === 'new' ? undefined : editing}
            canSetCredit={canSetCredit}
            rates={rates.data?.data ?? []}
            onDone={() => setEditing(null)}
          />
        ) : null}

        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px]">
          <input
            aria-label="Search customers"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name or phone…"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            aria-label="Filter customers by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>

        {customers.isPending ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {customers.isError ? (
          <p role="alert" className="py-4 text-sm text-red-700">
            {customers.error instanceof Error
              ? customers.error.message
              : 'Could not load customers.'}
          </p>
        ) : null}
        {customers.data?.data.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No customers match this filter.</p>
        ) : null}
        {customers.data?.data.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-2">Name</th>
                <th className="py-2">Phone / address</th>
                <th className="py-2 text-right">Credit limit</th>
                <th className="py-2 text-right">Loyalty</th>
                <th className="py-2">Status</th>
                {canManage ? <th className="py-2 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {customers.data.data.map((customer) => (
                <tr key={customer.id} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{customer.name}</td>
                  <td className="py-2 text-slate-600">
                    <span className="block">{customer.phone ?? 'No phone'}</span>
                    <span className="text-xs">{customer.address ?? 'No address'}</span>
                  </td>
                  <td className="py-2 text-right">
                    {customer.credit_limit ? formatNpr(customer.credit_limit) : 'Unlimited'}
                  </td>
                  <td className="py-2 text-right">{customer.loyalty_points}</td>
                  <td className="py-2">{customer.is_active ? 'Active' : 'Inactive'}</td>
                  {canManage ? (
                    <td className="py-2 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(customer)}>
                        Edit
                      </Button>{' '}
                      {customer.is_active ? (
                        <button
                          type="button"
                          className="ml-2 text-sm text-red-700 underline"
                          disabled={deactivate.isPending}
                          onClick={() => {
                            if (window.confirm(`Deactivate ${customer.name}?`)) {
                              deactivate.mutate(customer.id);
                            }
                          }}
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <Pager page={page} totalPages={customers.data?.meta?.total_pages ?? 1} onPage={setPage} />
      </Card>
    </main>
  );
}

function initial(customer?: Customer): CustomerPayload {
  return {
    name: customer?.name ?? '',
    phone: customer?.phone ?? null,
    address: customer?.address ?? null,
    default_rate_type: customer?.default_rate_type ?? null,
    credit_limit: customer?.credit_limit ?? null,
    opening_balance: customer?.opening_balance ?? '0.00',
    birthday_bs: customer?.birthday_bs ?? null,
    gender: customer?.gender ?? null,
    note: customer?.note ?? null,
  };
}

function CustomerForm({
  customer,
  canSetCredit,
  rates,
  onDone,
}: {
  customer?: Customer;
  canSetCredit: boolean;
  rates: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => initial(customer));
  const save = useMutation({
    mutationFn: (payload: CustomerPayload) =>
      customer ? updateCustomer(customer.id, payload) : createCustomer(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const payload: CustomerPayload = {
      ...form,
      name: form.name.trim(),
      phone: form.phone?.trim() || null,
      address: form.address?.trim() || null,
      birthday_bs: form.birthday_bs?.trim() || null,
      note: form.note?.trim() || null,
    };
    if (!canSetCredit) delete payload.credit_limit;
    save.mutate(payload);
  };

  return (
    <form
      onSubmit={submit}
      className="mb-5 grid gap-3 rounded-md bg-blue-50 p-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <Input
        label="Customer name"
        required
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />
      <Input
        label="Phone"
        value={form.phone ?? ''}
        onChange={(event) => setForm({ ...form, phone: event.target.value })}
      />
      <Input
        label="Address"
        value={form.address ?? ''}
        onChange={(event) => setForm({ ...form, address: event.target.value })}
      />
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Default rate
        <select
          value={form.default_rate_type ?? ''}
          onChange={(event) => setForm({ ...form, default_rate_type: event.target.value || null })}
          className="rounded-md border border-slate-300 px-3 py-2 font-normal"
        >
          <option value="">Shop default</option>
          {rates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {rate.name}
            </option>
          ))}
        </select>
      </label>
      {canSetCredit ? (
        <Input
          label="Credit limit"
          inputMode="decimal"
          value={form.credit_limit ?? ''}
          onChange={(event) => setForm({ ...form, credit_limit: event.target.value || null })}
          placeholder="Blank = unlimited"
        />
      ) : null}
      <Input
        label="Opening balance"
        inputMode="decimal"
        value={form.opening_balance ?? '0.00'}
        onChange={(event) => setForm({ ...form, opening_balance: event.target.value })}
      />
      <Input
        label="Birthday (BS)"
        value={form.birthday_bs ?? ''}
        onChange={(event) => setForm({ ...form, birthday_bs: event.target.value })}
        placeholder="2082-04-12"
      />
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Gender
        <select
          value={form.gender ?? ''}
          onChange={(event) => setForm({ ...form, gender: event.target.value || null })}
          className="rounded-md border border-slate-300 px-3 py-2 font-normal"
        >
          <option value="">Not specified</option>
          <option value="F">Female</option>
          <option value="M">Male</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <Input
        label="Note"
        value={form.note ?? ''}
        onChange={(event) => setForm({ ...form, note: event.target.value })}
      />
      {save.isError ? (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2 lg:col-span-3">
          {save.error instanceof ApiError ? save.error.message : 'Could not save customer.'}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={save.isPending}>
          Save customer
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
