import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Shown in place of a screen that crashed, or whose code could not be loaded
 * (offline, or a newer version was deployed). The dashboard link is a plain
 * link on purpose: it starts the app fresh.
 */
export function ErrorPage() {
  const { t } = useTranslation();
  return (
    <main role="alert" className="mx-auto max-w-xl p-4 text-center sm:p-8">
      <EmptyState
        icon={TriangleAlert}
        title={t('errorPage.title')}
        body={t('errorPage.body')}
        action={{ label: t('common.reload'), onClick: () => window.location.reload() }}
      />
      <a className="mt-4 inline-block text-sm text-primary underline" href="/">
        {t('access.home')}
      </a>
    </main>
  );
}
