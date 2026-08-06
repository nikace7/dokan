import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { listAuditLogs } from '@/features/audit/api';
import type { AuditLog } from '@/features/audit/api';
import { ApiError } from '@/lib/api/client';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function formatCreatedAt(value: string): string {
  return new Date(value).toLocaleString('en-NP', { timeZone: 'Asia/Kathmandu' });
}

function JsonBlock({ value }: { value: Record<string, unknown> | null }) {
  return (
    <pre className="overflow-x-auto rounded bg-foreground p-2 text-xs text-background">
      {value ? JSON.stringify(value, null, 2) : '—'}
    </pre>
  );
}

function AuditDetail({ row }: { row: AuditLog }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 border-t border-border bg-muted/50 px-3 py-3 sm:grid-cols-2">
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          {t('audit.before')}
        </h3>
        <JsonBlock value={row.before} />
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          {t('audit.after')}
        </h3>
        <JsonBlock value={row.after} />
      </div>
      <dl className="grid gap-1 text-xs text-muted-foreground sm:col-span-2 sm:grid-cols-3">
        <div>
          <dt className="font-medium text-foreground">{t('audit.targetId')}</dt>
          <dd className="break-all">{row.target_id || '—'}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">{t('audit.ip')}</dt>
          <dd>{row.ip || '—'}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">{t('audit.impersonatedBy')}</dt>
          <dd>{row.impersonated_by || '—'}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Owner-only, read-only audit trail; mutations stay in backend services. */
export function AuditPage() {
  const { t } = useTranslation();
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
      <Card title={t('audit.title')}>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label={t('audit.action')}
            value={action}
            onChange={(event) => resetPage(setAction, event.target.value)}
            placeholder={t('audit.actionPlaceholder')}
          />
          <Input
            label={t('audit.targetType')}
            value={targetType}
            onChange={(event) => resetPage(setTargetType, event.target.value)}
            placeholder={t('audit.targetTypePlaceholder')}
          />
          <Input
            label={t('audit.fromAd')}
            type="date"
            value={dateFrom}
            onChange={(event) => resetPage(setDateFrom, event.target.value)}
          />
          <Input
            label={t('audit.toAd')}
            type="date"
            value={dateTo}
            onChange={(event) => resetPage(setDateTo, event.target.value)}
          />
        </div>
        {query.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {query.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage(query.error, t('audit.loadError'))}
          </p>
        ) : null}
        {query.data && rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('audit.empty')}</p>
        ) : null}
        {rows.map((row) => (
          <div key={row.id} className="border-b border-border last:border-0">
            <button
              type="button"
              aria-expanded={expandedId === row.id}
              onClick={() => setExpandedId((current) => (current === row.id ? null : row.id))}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-2 py-3 text-left text-sm hover:bg-muted/50"
            >
              <span className="font-medium">{row.action}</span>
              <span className="text-muted-foreground">{row.target_type}</span>
              <span className="text-muted-foreground">{row.actor_name || t('audit.system')}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {formatCreatedAt(row.created_at)}
              </span>
            </button>
            {expandedId === row.id ? <AuditDetail row={row} /> : null}
          </div>
        ))}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('common.pageOf', { page: meta.page, total: meta.total_pages })} (
              {t('audit.count', { count: meta.count })})
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('common.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
