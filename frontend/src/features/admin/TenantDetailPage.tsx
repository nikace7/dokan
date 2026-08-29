import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getTenant, listUsage, updateTenant } from '@/features/admin/api';
import type { TenantStatus } from '@/features/admin/api';
import {
  AdminCard,
  EmptyState,
  LoadingRows,
  PageHeader,
  StatusBadge,
} from '@/features/admin/components';
import { FeatureTogglesPanel } from '@/features/admin/FeatureTogglesPanel';
import { ShopfrontPanel } from '@/features/admin/ShopfrontPanel';
import { SupportAccessPanel } from '@/features/admin/SupportAccessPanel';
import { TenantBillingPanel } from '@/features/admin/TenantBillingPanel';
import { TenantOverridesPanel } from '@/features/admin/TenantOverridesPanel';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';
import { ApiError } from '@/lib/api/client';

const SUSPENDABLE: readonly TenantStatus[] = ['TRIAL', 'ACTIVE', 'PAST_DUE'];
const REACTIVATABLE: readonly TenantStatus[] = ['SUSPENDED', 'PAST_DUE'];

/** ISO timestamp → date part for display; em dash when unset. */
function isoDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '—';
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Tenant detail: lifecycle actions, profile facts, usage snapshots, and the
 * billing / overrides / feature-toggle / support-access panels (owned by
 * their own slices — embedded here with unchanged props).
 */
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
  const [confirm, setConfirm] = useState<TenantStatus | null>(null);
  const lifecycle = useMutation({
    mutationFn: (status: TenantStatus) => updateTenant(id, { status }),
    onSuccess: async () => {
      setConfirm(null);
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants', id] });
    },
  });
  const currencyMutation = useMutation({
    mutationFn: (currency: 'NPR' | 'INR') => updateTenant(id, { currency }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants', id] });
    },
  });

  if (tenant.isPending) {
    return (
      <main className="mx-auto max-w-6xl p-4">
        <p className="text-sm text-muted-foreground">Loading tenant…</p>
      </main>
    );
  }
  if (tenant.isError || !tenant.data) {
    return (
      <main className="mx-auto max-w-6xl p-4">
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {tenant.error instanceof Error ? tenant.error.message : 'Tenant not found.'}
        </p>
        <Link
          className="mt-2 inline-block text-sm text-primary hover:underline"
          to="/admin/tenants"
        >
          ← All tenants
        </Link>
      </main>
    );
  }

  const current = tenant.data;
  const canManage = user?.role === 'SUPER_ADMIN';
  const usageRows = usage.data?.data ?? [];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <div>
        <Link className="text-sm text-primary hover:underline" to="/admin/tenants">
          ← All tenants
        </Link>
        <PageHeader
          className="mt-1"
          title={current.name}
          description={current.slug}
          actions={
            <>
              <StatusBadge status={current.status} />
              {canManage && SUSPENDABLE.includes(current.status) ? (
                <Button variant="secondary" size="sm" onClick={() => setConfirm('SUSPENDED')}>
                  Suspend
                </Button>
              ) : null}
              {canManage && REACTIVATABLE.includes(current.status) ? (
                <Button size="sm" onClick={() => setConfirm('ACTIVE')}>
                  Reactivate
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      <AdminCard title="Tenant profile">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <Fact label="Plan" value={current.plan_name} />
          <Fact label="Legal name" value={current.legal_name ?? '—'} />
          <Fact label="PAN/VAT no." value={current.pan_vat_no ?? '—'} />
          <Fact label="VAT registered" value={current.vat_registered ? 'Yes' : 'No'} />
          <Fact label="Calendar" value={current.calendar_pref} />
          <Fact label="Locale" value={current.locale} />
          <div>
            <dt className="text-muted-foreground">Currency</dt>
            <dd className="font-medium text-foreground">
              {canManage ? (
                <select
                  value={current.currency}
                  disabled={currencyMutation.isPending}
                  onChange={(event) => currencyMutation.mutate(event.target.value as 'NPR' | 'INR')}
                  aria-label="Currency"
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                >
                  <option value="NPR">NPR</option>
                  <option value="INR">INR</option>
                </select>
              ) : (
                current.currency
              )}
            </dd>
          </div>
          <Fact label="Trial ends" value={isoDate(current.trial_ends_at)} />
          <Fact label="Onboarded" value={isoDate(current.onboarded_at)} />
          <Fact label="Created" value={isoDate(current.created_at)} />
        </dl>
      </AdminCard>

      <AdminCard
        title="Usage"
        description="Latest reconciled snapshots (written nightly)."
        contentClassName="p-0"
      >
        {usage.isPending || usageRows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Date</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Invoices MTD</TableHead>
                <TableHead className="px-4 text-right">SMS used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.isPending ? (
                <LoadingRows columns={5} rows={3} />
              ) : (
                usageRows.slice(0, 10).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="px-4">{row.date}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.users}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.items}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.invoices_mtd}</TableCell>
                    <TableCell className="px-4 text-right tabular-nums">{row.sms_used}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        ) : null}
        {usage.data && usageRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No usage snapshots yet"
              body="Usage is reconciled nightly; the first snapshot appears after the job runs."
            />
          </div>
        ) : null}
      </AdminCard>

      {user ? <TenantBillingPanel tenantId={id} role={user.role} /> : null}
      {user ? (
        <FeatureTogglesPanel
          tenantId={id}
          planId={current.plan}
          canWrite={user.role === 'SUPER_ADMIN'}
        />
      ) : null}
      {user ? <ShopfrontPanel tenant={current} canWrite={user.role === 'SUPER_ADMIN'} /> : null}
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

      <Dialog open={confirm !== null} onOpenChange={(open) => (open ? null : setConfirm(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'SUSPENDED' ? 'Suspend tenant?' : 'Reactivate tenant?'}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'SUSPENDED'
                ? `${current.name} will immediately lose access to their shop until reactivated.`
                : `${current.name} will regain access as an ACTIVE tenant.`}
            </DialogDescription>
          </DialogHeader>
          {lifecycle.isError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {lifecycle.error instanceof ApiError
                ? lifecycle.error.message
                : 'Could not update the tenant.'}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              disabled={lifecycle.isPending}
              onClick={() => {
                if (confirm) lifecycle.mutate(confirm);
              }}
            >
              {lifecycle.isPending ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
