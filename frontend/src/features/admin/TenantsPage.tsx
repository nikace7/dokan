import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listPlans, listTenants } from '@/features/admin/api';
import type { TenantStatus } from '@/features/admin/api';
import {
  AdminCard,
  EmptyState,
  LoadingRows,
  PageHeader,
  StatusBadge,
} from '@/features/admin/components';
import { NewTenantDialog } from '@/features/admin/TenantsPage.parts';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';
import { ApiError } from '@/lib/api/client';

const STATUSES: readonly TenantStatus[] = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'];

const selectClasses =
  'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Tenant list: search/status/plan filters, paged table, and the provisioning
 * dialog (SUPER_ADMIN only). Support and billing roles get a read-only view.
 */
export function TenantsPage() {
  const { user } = usePlatformAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const plans = useQuery({
    queryKey: ['platform', 'plans', true],
    queryFn: () => listPlans(true),
  });
  const tenants = useQuery({
    queryKey: ['platform', 'tenants', search, status, plan, page],
    queryFn: () => listTenants({ search: search.trim(), status, plan, page }),
  });

  const rows = tenants.data?.data ?? [];
  const meta = tenants.data?.meta ?? null;
  const canCreate = user?.role === 'SUPER_ADMIN';

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <PageHeader
        title="Tenants"
        description="Provision and manage shop tenants."
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              New tenant
            </Button>
          ) : null
        }
      />

      <AdminCard contentClassName="p-0">
        <div className="flex flex-wrap gap-2 border-b p-4">
          <Input
            aria-label="Search tenants"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Shop name or subdomain"
            className="min-w-64 sm:max-w-xs"
          />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className={selectClasses}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by plan"
            value={plan}
            onChange={(event) => {
              setPlan(event.target.value);
              setPage(1);
            }}
            className={selectClasses}
          >
            <option value="">All plans</option>
            {(plans.data?.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        {tenants.isError ? (
          <p role="alert" className="m-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {tenants.error instanceof ApiError || tenants.error instanceof Error
              ? tenants.error.message
              : 'Could not load tenants.'}
          </p>
        ) : null}

        {tenants.isPending || rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Shop</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.isPending ? (
                <LoadingRows columns={5} />
              ) : (
                rows.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell className="px-4 font-medium">
                      <Link
                        className="text-primary hover:underline"
                        to={`/admin/tenants/${tenant.id}`}
                      >
                        {tenant.name}
                      </Link>
                    </TableCell>
                    <TableCell>{tenant.slug}</TableCell>
                    <TableCell className="text-muted-foreground">{tenant.plan_name}</TableCell>
                    <TableCell>
                      <StatusBadge status={tenant.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {tenant.created_at.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        ) : null}

        {tenants.data && rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No tenants found"
              body="No tenants match the current filters. Adjust the search or clear a filter."
            />
          </div>
        ) : null}

        {meta && meta.total_pages > 1 ? (
          <div className="flex items-center justify-between border-t p-4 text-sm">
            <span className="text-muted-foreground">
              Page {meta.page} of {meta.total_pages} · {meta.count} tenants
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= meta.total_pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </AdminCard>

      {creating ? (
        <NewTenantDialog
          open
          plans={(plans.data?.data ?? []).filter((item) => item.is_active)}
          onOpenChange={setCreating}
        />
      ) : null}
    </main>
  );
}
