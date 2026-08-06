import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { listSupportSessions } from '@/features/support/api';

function local(value: string): string {
  return new Date(value).toLocaleString('en-NP', { timeZone: 'Asia/Kathmandu' });
}

export function SupportAccessPage() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['support-access', 'list'],
    queryFn: listSupportSessions,
    retry: false,
  });

  return (
    <main className="mx-auto max-w-5xl p-4">
      <Card title={t('support.page.title')}>
        {query.isPending ? <p className="text-sm text-slate-500">{t('common.loading')}</p> : null}
        {query.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {t('support.page.error')}
          </p>
        ) : null}
        {query.data?.length === 0 ? (
          <p className="text-sm text-slate-500">{t('support.page.empty')}</p>
        ) : null}
        <div className="divide-y divide-slate-200">
          {query.data?.map((row) => (
            <article key={row.id} className="grid gap-1 py-3 text-sm sm:grid-cols-2">
              <strong>{row.platform_user_name}</strong>
              <span className="sm:text-right">
                {row.scope === 'READ_ONLY'
                  ? t('support.banner.readOnly')
                  : t('support.banner.readWrite')}
              </span>
              <span>{row.reason}</span>
              <span className="text-slate-500 sm:text-right">
                {local(row.started_at)} –{' '}
                {row.ended_at ? local(row.ended_at) : local(row.expires_at)}
              </span>
            </article>
          ))}
        </div>
      </Card>
    </main>
  );
}
