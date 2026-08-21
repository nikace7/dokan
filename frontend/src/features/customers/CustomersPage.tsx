import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { formatNpr, useMoneyDisplay } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';

type StatusFilter = 'active' | 'inactive' | 'all';

const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

export function CustomersPage() {
  const { t } = useTranslation();
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

  if (isRestoring) {
    return <main className="p-6 text-sm text-muted-foreground">{t('customers.loading')}</main>;
  }
  if (!canView) {
    return <main className="p-6 text-sm text-warning">{t('customers.noViewPermission')}</main>;
  }

  const rows = customers.data?.data ?? [];

  return (
    <main className="mx-auto max-w-6xl p-4">
      <Card
        title={t('customers.title')}
        actions={
          canManage ? <Button onClick={() => setEditing('new')}>{t('customers.new')}</Button> : null
        }
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
          <Input
            aria-label={t('customers.searchAria')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={t('common.searchByNameOrPhone')}
          />
          <select
            aria-label={t('customers.statusFilterAria')}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
              setPage(1);
            }}
            className={selectClasses}
          >
            <option value="active">{t('customers.statusActive')}</option>
            <option value="inactive">{t('customers.statusInactive')}</option>
            <option value="all">{t('customers.statusAll')}</option>
          </select>
        </div>

        {customers.isPending ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {customers.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {customers.error instanceof Error ? customers.error.message : t('customers.loadError')}
          </p>
        ) : null}
        {customers.data && rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('customers.empty')}</p>
        ) : null}
        {rows.length ? (
          <CustomerList
            customers={rows}
            canManage={canManage}
            onEdit={setEditing}
            onDeactivate={(customer) => {
              if (window.confirm(t('customers.deactivateConfirm', { name: customer.name }))) {
                deactivate.mutate(customer.id);
              }
            }}
            deactivatePending={deactivate.isPending}
          />
        ) : null}
        <Pager page={page} totalPages={customers.data?.meta?.total_pages ?? 1} onPage={setPage} />
      </Card>
    </main>
  );
}

function CustomerActions({
  customer,
  onEdit,
  onDeactivate,
  deactivatePending,
}: {
  customer: Customer;
  onEdit: (customer: Customer) => void;
  onDeactivate: (customer: Customer) => void;
  deactivatePending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => onEdit(customer)}>
        {t('customers.edit')}
      </Button>
      {customer.is_active ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={deactivatePending}
          onClick={() => onDeactivate(customer)}
        >
          {t('customers.deactivate')}
        </Button>
      ) : null}
    </div>
  );
}

/** Card list below `md`, full table from `md` up — both render the same rows. */
function CustomerList({
  customers,
  canManage,
  onEdit,
  onDeactivate,
  deactivatePending,
}: {
  customers: Customer[];
  canManage: boolean;
  onEdit: (customer: Customer) => void;
  onDeactivate: (customer: Customer) => void;
  deactivatePending: boolean;
}) {
  const { t } = useTranslation();
  useMoneyDisplay();
  return (
    <>
      <ul className="divide-y divide-border md:hidden">
        {customers.map((customer) => (
          <li key={customer.id} className="py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{customer.name}</p>
                <p className="text-sm text-muted-foreground">
                  {customer.phone ?? t('common.noPhone')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {customer.address ?? t('customers.noAddress')}
                </p>
              </div>
              <Badge variant={customer.is_active ? 'success' : 'secondary'}>
                {customer.is_active ? t('customers.statusActive') : t('customers.statusInactive')}
              </Badge>
            </div>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-1">
                <dt className="text-muted-foreground">{t('customers.creditLimit')}</dt>
                <dd className="tabular-nums">
                  {customer.credit_limit
                    ? formatNpr(customer.credit_limit)
                    : t('customers.unlimited')}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt className="text-muted-foreground">{t('customers.loyalty')}</dt>
                <dd className="tabular-nums">{customer.loyalty_points}</dd>
              </div>
            </dl>
            {canManage ? (
              <div className="mt-2">
                <CustomerActions
                  customer={customer}
                  onEdit={onEdit}
                  onDeactivate={onDeactivate}
                  deactivatePending={deactivatePending}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('customers.tableName')}</TableHead>
              <TableHead>{t('customers.tablePhoneAddress')}</TableHead>
              <TableHead className="text-right">{t('customers.creditLimit')}</TableHead>
              <TableHead className="text-right">{t('customers.loyalty')}</TableHead>
              <TableHead>{t('customers.tableStatus')}</TableHead>
              {canManage ? (
                <TableHead className="text-right">{t('customers.tableActions')}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell className="font-medium">{customer.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="block">{customer.phone ?? t('common.noPhone')}</span>
                  <span className="text-xs">{customer.address ?? t('customers.noAddress')}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {customer.credit_limit
                    ? formatNpr(customer.credit_limit)
                    : t('customers.unlimited')}
                </TableCell>
                <TableCell className="text-right tabular-nums">{customer.loyalty_points}</TableCell>
                <TableCell>
                  <Badge variant={customer.is_active ? 'success' : 'secondary'}>
                    {customer.is_active
                      ? t('customers.statusActive')
                      : t('customers.statusInactive')}
                  </Badge>
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <CustomerActions
                        customer={customer}
                        onEdit={onEdit}
                        onDeactivate={onDeactivate}
                        deactivatePending={deactivatePending}
                      />
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
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
  const { t } = useTranslation();
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
      className="mb-5 grid gap-3 rounded-md border border-border bg-muted/50 p-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <Input
        label={t('customers.form.name')}
        required
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />
      <Input
        label={t('customers.form.phone')}
        value={form.phone ?? ''}
        onChange={(event) => setForm({ ...form, phone: event.target.value })}
      />
      <Input
        label={t('customers.form.address')}
        value={form.address ?? ''}
        onChange={(event) => setForm({ ...form, address: event.target.value })}
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t('customers.form.defaultRate')}
        <select
          value={form.default_rate_type ?? ''}
          onChange={(event) => setForm({ ...form, default_rate_type: event.target.value || null })}
          className={`${selectClasses} font-normal`}
        >
          <option value="">{t('customers.form.shopDefault')}</option>
          {rates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {rate.name}
            </option>
          ))}
        </select>
      </label>
      {canSetCredit ? (
        <Input
          label={t('customers.form.creditLimit')}
          inputMode="decimal"
          value={form.credit_limit ?? ''}
          onChange={(event) => setForm({ ...form, credit_limit: event.target.value || null })}
          placeholder={t('customers.form.creditUnlimited')}
        />
      ) : null}
      <Input
        label={t('customers.form.openingBalance')}
        inputMode="decimal"
        value={form.opening_balance ?? '0.00'}
        onChange={(event) => setForm({ ...form, opening_balance: event.target.value })}
      />
      <Input
        label={t('customers.form.birthdayBs')}
        value={form.birthday_bs ?? ''}
        onChange={(event) => setForm({ ...form, birthday_bs: event.target.value })}
        placeholder="2082-04-12"
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t('customers.form.gender')}
        <select
          value={form.gender ?? ''}
          onChange={(event) => setForm({ ...form, gender: event.target.value || null })}
          className={`${selectClasses} font-normal`}
        >
          <option value="">{t('customers.form.genderUnspecified')}</option>
          <option value="F">{t('customers.form.genderFemale')}</option>
          <option value="M">{t('customers.form.genderMale')}</option>
          <option value="OTHER">{t('customers.form.genderOther')}</option>
        </select>
      </label>
      <Input
        label={t('common.note')}
        value={form.note ?? ''}
        onChange={(event) => setForm({ ...form, note: event.target.value })}
      />
      {save.isError ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2 lg:col-span-3"
        >
          {save.error instanceof ApiError ? save.error.message : t('customers.form.saveError')}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={save.isPending}>
          {t('customers.form.save')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
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
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('common.previous')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        {t('common.next')}
      </Button>
    </div>
  );
}
