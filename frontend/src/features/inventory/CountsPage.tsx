import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TableCell } from '@/components/ui/table';
import { useAuth } from '@/features/auth/useAuth';
import {
  cancelCount,
  finalizeCount,
  listCounts,
  recordCounts,
  startCount,
} from '@/features/inventory/api';
import type { StockCount } from '@/features/inventory/api';
import { cellInputClasses } from '@/features/inventory/ui';
import { ReportTable } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { ApiError } from '@/lib/api/client';
import type { Page } from '@/lib/api/client';
import { cn } from '@/lib/utils';
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
          <p className="text-sm text-muted-foreground">
            Snapshot, count every line, review variance, then finalize once.
          </p>
        </div>
        <Link className="text-sm text-primary hover:underline" to="/stock">
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
        <p className="text-sm text-muted-foreground">
          Starting snapshots every stocked variant in the selected branch. Only one count can be
          open per branch.
        </p>
      </Card>
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {countsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {countsQuery.isError ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {message(countsQuery.error, 'Could not load counts.')}
        </p>
      ) : null}
      {countsQuery.data && counts.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">No physical counts for this branch yet.</p>
        </Card>
      ) : null}
      {counts.map((count) => (
        <CountCard key={count.id} count={count} canAdjust={canAdjust} onUpdated={updateCount} />
      ))}
    </main>
  );
}

const COUNT_COLUMNS: readonly ReportColumn[] = [
  { header: 'Item' },
  { header: 'SKU' },
  { header: 'System', className: 'text-right' },
  { header: 'Counted', className: 'text-right' },
  { header: 'Variance', className: 'text-right' },
  { header: 'Note' },
];

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
  const counting = count.status === 'OPEN' && canAdjust;

  const countedInput = (variant: string, sku: string) => (
    <input
      aria-label={`Counted quantity ${sku}`}
      type="number"
      min="0"
      step="0.001"
      value={values[variant] ?? ''}
      onChange={(event) =>
        setValues((current) => ({ ...current, [variant]: event.target.value }))
      }
      className={cn(cellInputClasses, 'w-28 text-right')}
    />
  );
  const noteInput = (variant: string, sku: string) => (
    <input
      aria-label={`Count note ${sku}`}
      value={notes[variant] ?? ''}
      onChange={(event) =>
        setNotes((current) => ({ ...current, [variant]: event.target.value }))
      }
      className={cn(cellInputClasses, 'w-44')}
    />
  );

  return (
    <Card
      title={`${count.status} · ${count.branch_code}`}
      actions={
        <Badge variant="secondary" className="font-medium">
          Started by {count.created_by_name ?? 'System'}
        </Badge>
      }
    >
      <ReportTable
        columns={COUNT_COLUMNS}
        rows={count.items}
        rowKey={(item) => item.id}
        empty="No lines on this count."
        renderCells={(item) => (
          <>
            <TableCell className="font-medium">{item.item_name}</TableCell>
            <TableCell className="text-muted-foreground">{item.variant_sku}</TableCell>
            <TableCell className="text-right tabular-nums">{item.system_qty}</TableCell>
            <TableCell className="text-right tabular-nums">
              {counting ? countedInput(item.variant, item.variant_sku) : (item.counted_qty ?? '—')}
            </TableCell>
            <TableCell className="text-right tabular-nums">{item.variance ?? '—'}</TableCell>
            <TableCell>
              {counting ? noteInput(item.variant, item.variant_sku) : (item.note ?? '—')}
            </TableCell>
          </>
        )}
        renderCard={(item) => (
          <div className="text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{item.item_name}</p>
                <p className="text-muted-foreground">{item.variant_sku}</p>
              </div>
              <p className="shrink-0 text-right tabular-nums">
                System {item.system_qty} · variance {item.variance ?? '—'}
              </p>
            </div>
            {counting ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {countedInput(item.variant, item.variant_sku)}
                {noteInput(item.variant, item.variant_sku)}
              </div>
            ) : (
              <p className="mt-1 text-muted-foreground">
                Counted {item.counted_qty ?? '—'} · {item.note ?? '—'}
              </p>
            )}
          </div>
        )}
      />
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {counting ? (
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
