import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { listAuditLogs } from '@/features/audit/api';
import type { AuditLog } from '@/features/audit/api';
import { ApiError } from '@/lib/api/client';

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Could not load the audit log.';
}

function formatCreatedAt(value: string): string {
  return new Date(value).toLocaleString('en-NP', { timeZone: 'Asia/Kathmandu' });
}

function JsonBlock({ value }: { value: Record<string, unknown> | null }) {
  return (
    <pre className="overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">
      {value ? JSON.stringify(value, null, 2) : '—'}
    </pre>
  );
}

function AuditDetail({ row }: { row: AuditLog }) {
  return (
    <div className="grid gap-3 border-t border-slate-200 bg-slate-50 px-3 py-3 sm:grid-cols-2">
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Before</h3>
        <JsonBlock value={row.before} />
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">After</h3>
        <JsonBlock value={row.after} />
      </div>
      <dl className="grid gap-1 text-xs text-slate-600 sm:col-span-2 sm:grid-cols-3">
        <div>
          <dt className="font-medium">Target ID</dt>
          <dd className="break-all">{row.target_id || '—'}</dd>
        </div>
        <div>
          <dt className="font-medium">IP</dt>
          <dd>{row.ip || '—'}</dd>
        </div>
        <div>
          <dt className="font-medium">Impersonated by</dt>
          <dd>{row.impersonated_by || '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Owner-only, read-only audit trail; mutations stay in backend services. */
export function AuditPage() {
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['audit', 'list', action, targetType, dateFrom, dateTo, page],
    queryFn: () =>
      listAuditLogs({
        action: action.trim() || undefined,
        targetType: targetType.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
      }),
  });
  const rows = query.data?.data ?? [];
  const meta = query.data?.meta ?? null;

  function resetPage(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Card title="Audit log / गतिविधि इतिहास">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Action"
            value={action}
            onChange={(event) => resetPage(setAction, event.target.value)}
            placeholder="e.g. price.set"
          />
          <Input
            label="Target type"
            value={targetType}
            onChange={(event) => resetPage(setTargetType, event.target.value)}
            placeholder="e.g. item_price"
          />
          <Input
            label="From AD"
            type="date"
            value={dateFrom}
            onChange={(event) => resetPage(setDateFrom, event.target.value)}
          />
          <Input
            label="To AD"
            type="date"
            value={dateTo}
            onChange={(event) => resetPage(setDateTo, event.target.value)}
          />
        </div>
        {query.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {query.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {errorMessage(query.error)}
          </p>
        ) : null}
        {query.data && rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No audit events found.</p>
        ) : null}
        {rows.map((row) => (
          <div key={row.id} className="border-b border-slate-100 last:border-0">
            <button
              type="button"
              aria-expanded={expandedId === row.id}
              onClick={() => setExpandedId((current) => (current === row.id ? null : row.id))}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-2 py-3 text-left text-sm hover:bg-slate-50"
            >
              <span className="font-medium">{row.action}</span>
              <span className="text-slate-600">{row.target_type}</span>
              <span className="text-slate-500">{row.actor_name || 'System'}</span>
              <span className="ml-auto text-xs text-slate-500">
                {formatCreatedAt(row.created_at)}
              </span>
            </button>
            {expandedId === row.id ? <AuditDetail row={row} /> : null}
          </div>
        ))}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Page {meta.page} of {meta.total_pages} ({meta.count} events)
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((current) => current + 1)}
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
