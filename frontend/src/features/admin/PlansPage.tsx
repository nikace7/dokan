import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody } from '@/components/ui/table';
import { listPlans } from '@/features/admin/api';
import type { Plan } from '@/features/admin/api';
import { EmptyState, LoadingRows, PageHeader } from '@/features/admin/components';
import { PlanForm } from '@/features/admin/PlansPage.parts';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';
import { formatNpr } from '@/lib/money';

function entries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

function formatValue(value: unknown): string {
  if (value === true) return 'On';
  if (value === false) return 'Off';
  return String(value);
}

function ConfigList({ title, values }: { title: string; values: Record<string, unknown> }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h4>
      {entries(values).length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">None set.</p>
      ) : (
        <dl className="mt-1 space-y-0.5">
          {entries(values).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2 text-xs">
              <dt className="font-mono text-muted-foreground">{key}</dt>
              <dd className="font-medium text-foreground">{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
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
      <PageHeader
        title="Plans"
        description="Subscription plans: price, usage limits, and the features each plan unlocks."
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              New plan
            </Button>
          ) : null
        }
      />

      {plans.isPending ? (
        <Table>
          <TableBody>
            <LoadingRows columns={1} rows={3} />
          </TableBody>
        </Table>
      ) : null}
      {plans.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {plans.error instanceof Error ? plans.error.message : 'Could not load plans.'}
        </p>
      ) : null}
      {plans.data?.data.length === 0 ? (
        <EmptyState
          title="No plans yet"
          body="Create the first plan so tenants can be subscribed to it."
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {plans.data?.data.map((plan) => (
          <section key={plan.id} className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-foreground">{plan.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {plan.code} · {plan.billing_cycle}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!plan.is_active ? <Badge variant="outline">Inactive</Badge> : null}
                {canWrite ? (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(plan)}>
                    Edit
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-lg font-semibold text-foreground">{formatNpr(plan.price_npr)}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <ConfigList title="Limits" values={plan.limits} />
              <ConfigList title="Features" values={plan.features} />
            </div>
          </section>
        ))}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'New plan' : 'Edit plan'}</DialogTitle>
            <DialogDescription>
              Limits cap how much a shop can use; features switch whole modules on or off. Leave a
              limit blank for unlimited.
            </DialogDescription>
          </DialogHeader>
          {editing !== null ? (
            <PlanForm
              plan={editing === 'new' ? undefined : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
