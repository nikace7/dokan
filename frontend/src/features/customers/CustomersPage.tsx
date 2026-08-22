import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

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
import { deactivateCustomer, listCustomers } from '@/features/customers/api';
import type { Customer } from '@/features/customers/api';
import { CustomerForm, selectClasses } from '@/features/customers/CustomerForm';
import { listPricingRateTypes } from '@/features/pricing/api';
import { formatNpr, toPaisa, useMoneyDisplay } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';

type StatusFilter = 'active' | 'inactive' | 'all';

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

/** Phone number as a tel: link so the counter can call a khata customer directly. */
function PhoneLink({ phone }: { phone: string }) {
  return (
    <a
      href={`tel:${phone}`}
      className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
    >
      <Phone className="h-3.5 w-3.5" aria-hidden />
      {phone}
    </a>
  );
}

/** Loyalty points — rendered as a chip once the customer actually has points. */
function LoyaltyValue({ points }: { points: string }) {
  if (toPaisa(points) <= 0) return <>{points}</>;
  return <Badge variant="secondary">{points}</Badge>;
}

/** Khata shortcuts for active customers: collect dues or jump to the party ledger. */
function KhataLinks({ customer }: { customer: Customer }) {
  const { t } = useTranslation();
  return (
    <>
      <Button size="sm" variant="outline" asChild>
        <Link to={`/payments?customer=${customer.id}`}>
          {t('customers.receivePayment', { defaultValue: 'Receive payment' })}
        </Link>
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <Link to={`/ledgers?customer=${customer.id}`}>
          {t('customers.viewLedger', { defaultValue: 'Ledger' })}
        </Link>
      </Button>
    </>
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
                  {customer.phone ? <PhoneLink phone={customer.phone} /> : t('common.noPhone')}
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
                <dd className="tabular-nums">
                  <LoyaltyValue points={customer.loyalty_points} />
                </dd>
              </div>
            </dl>
            {customer.is_active || canManage ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {customer.is_active ? <KhataLinks customer={customer} /> : null}
                {canManage ? (
                  <CustomerActions
                    customer={customer}
                    onEdit={onEdit}
                    onDeactivate={onDeactivate}
                    deactivatePending={deactivatePending}
                  />
                ) : null}
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
              <TableHead className="text-right">{t('customers.tableActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell className="font-medium">{customer.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="block">
                    {customer.phone ? <PhoneLink phone={customer.phone} /> : t('common.noPhone')}
                  </span>
                  <span className="text-xs">{customer.address ?? t('customers.noAddress')}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {customer.credit_limit
                    ? formatNpr(customer.credit_limit)
                    : t('customers.unlimited')}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <LoyaltyValue points={customer.loyalty_points} />
                </TableCell>
                <TableCell>
                  <Badge variant={customer.is_active ? 'success' : 'secondary'}>
                    {customer.is_active
                      ? t('customers.statusActive')
                      : t('customers.statusInactive')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {customer.is_active ? <KhataLinks customer={customer} /> : null}
                    {canManage ? (
                      <CustomerActions
                        customer={customer}
                        onEdit={onEdit}
                        onDeactivate={onDeactivate}
                        deactivatePending={deactivatePending}
                      />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
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
