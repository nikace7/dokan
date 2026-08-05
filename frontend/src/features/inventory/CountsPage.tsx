import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/useAuth';
import {
  cancelCount,
  finalizeCount,
  listCounts,
  recordCounts,
  startCount,
} from '@/features/inventory/api';
import type { StockCount } from '@/features/inventory/api';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { ApiError } from '@/lib/api/client';
import type { Page } from '@/lib/api/client';
import { hasPermission } from '@/lib/permissions';

export function CountsPage() {
  const { user, isRestoring } = useAuth();
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const canView = hasPermission(user, 'stock.view');
  const canAdjust = hasPermission(user, 'stock.adjust');
  const queryKey = ['inventory', 'counts', workspace.branchId] as const;
  const countsQuery = useQuery({
    queryKey,
    queryFn: () => listCounts(workspace.branchId ?? undefined),
    enabled: canView && workspace.branchId !== null,
  });
  const updateCount = (updated: StockCount) => {
    queryClient.setQueryData<Page<StockCount>>(queryKey, (current) =>
      current
        ? {
            ...current,
            data: current.data.map((count) => (count.id === updated.id ? updated : count)),
          }
        : current,
    );
  };
  const start = useMutation({
    mutationFn: () => {
      if (!workspace.branchId) throw new Error('Select an active branch first.');
      return startCount(workspace.branchId);
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['inventory', 'counts'] });
    },
    onError: (reason) => setError(message(reason, 'Could not start the count.')),
  });

  if (isRestoring || !user) return <PageMessage>Loading…</PageMessage>;
  if (!canView)
    return <PageMessage>You do not have permission to view physical counts.</PageMessage>;

  const counts = countsQuery.data?.data ?? [];
  const branch = workspace.branches.find((item) => item.id === workspace.branchId);
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Physical counts / भौतिक गणना</h1>
          <p className="text-sm text-slate-500">
            Snapshot, count every line, review variance, then finalize once.
          </p>
        </div>
        <Link className="text-sm text-blue-700 underline" to="/stock">
          Back to stock
        </Link>
      </div>
      <Card
        title={`Branch: ${branch?.code ?? 'Loading…'}`}
        actions={
          canAdjust ? (
            <Button
              size="sm"
              onClick={() => start.mutate()}
              disabled={!workspace.branchId || start.isPending}
            >
              Start physical count
            </Button>
          ) : undefined
        }
      >
        <p className="text-sm text-slate-600">
          Starting snapshots every stocked variant in the selected branch. Only one count can be
          open per branch.
        </p>
      </Card>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {countsQuery.isPending ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {countsQuery.isError ? (
        <p role="alert" className="text-sm text-red-700">
          {message(countsQuery.error, 'Could not load counts.')}
        </p>
      ) : null}
      {countsQuery.data && counts.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No physical counts for this branch yet.</p>
        </Card>
      ) : null}
      {counts.map((count) => (
        <CountCard key={count.id} count={count} canAdjust={canAdjust} onUpdated={updateCount} />
      ))}
    </main>
  );
}

function CountCard({
  count,
  canAdjust,
  onUpdated,
}: {
  count: StockCount;
  canAdjust: boolean;
  onUpdated: (count: StockCount) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(count.items.map((item) => [item.variant, item.counted_qty ?? ''])),
  );
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(count.items.map((item) => [item.variant, item.note ?? ''])),
  );
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ action }: { action: 'record' | 'finalize' | 'cancel' }) => {
      if (action === 'finalize') return finalizeCount(count.id);
      if (action === 'cancel')
        return cancelCount(count.id).then(() => ({ ...count, status: 'CANCELLED' as const }));
      const rows = count.items.flatMap((item) =>
        values[item.variant]?.trim() === ''
          ? []
          : [
              {
                variant: item.variant,
                counted_qty: values[item.variant],
                ...(notes[item.variant]?.trim() ? { note: notes[item.variant].trim() } : {}),
              },
            ],
      );
      if (rows.length === 0) throw new Error('Enter at least one counted quantity.');
      return recordCounts(count.id, rows);
    },
    onSuccess: (updated) => {
      setError(null);
      onUpdated(updated);
    },
    onError: (reason) => setError(message(reason, 'Could not update the count.')),
  });
  const complete = count.items.every((item) => item.counted_qty !== null);

  return (
    <Card
      title={`${count.status} · ${count.branch_code}`}
      actions={
        <span className="text-xs text-slate-500">
          Started by {count.created_by_name ?? 'System'}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500">
              <th className="py-2">Item</th>
              <th>SKU</th>
              <th className="text-right">System</th>
              <th className="pl-3 text-right">Counted</th>
              <th className="pl-3 text-right">Variance</th>
              <th className="pl-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {count.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="py-2">{item.item_name}</td>
                <td>{item.variant_sku}</td>
                <td className="text-right">{item.system_qty}</td>
                <td className="pl-3 text-right">
                  {count.status === 'OPEN' && canAdjust ? (
                    <input
                      aria-label={`Counted quantity ${item.variant_sku}`}
                      type="number"
                      min="0"
                      step="0.001"
                      value={values[item.variant] ?? ''}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [item.variant]: event.target.value }))
                      }
                      className="w-28 rounded border px-2 py-1 text-right"
                    />
                  ) : (
                    (item.counted_qty ?? '—')
                  )}
                </td>
                <td className="pl-3 text-right">{item.variance ?? '—'}</td>
                <td className="pl-3">
                  {count.status === 'OPEN' && canAdjust ? (
                    <input
                      aria-label={`Count note ${item.variant_sku}`}
                      value={notes[item.variant] ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [item.variant]: event.target.value }))
                      }
                      className="w-44 rounded border px-2 py-1"
                    />
                  ) : (
                    (item.note ?? '—')
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {count.status === 'OPEN' && canAdjust ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ action: 'record' })}
          >
            Save counted quantities
          </Button>
          <Button
            variant="secondary"
            disabled={mutation.isPending || !complete}
            onClick={() => mutation.mutate({ action: 'finalize' })}
          >
            Finalize count
          </Button>
          <Button
            variant="danger"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ action: 'cancel' })}
          >
            Cancel count
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function PageMessage({ children }: { children: string }) {
  return (
    <main className="mx-auto max-w-6xl p-4">
      <p role="alert">{children}</p>
    </main>
  );
}
function message(reason: unknown, fallback: string) {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}
