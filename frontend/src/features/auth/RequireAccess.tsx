import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { canOpen } from '@/components/layout/appNavigation';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/features/auth/useAuth';

/**
 * Page guard for typed URLs and old links: a role that cannot use the page
 * gets one calm explanation instead of the page's failing API calls. The
 * sidebar uses the same `canOpen` rule, so listed pages never land here.
 */
export function RequireAccess({ path, children }: { path: string; children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (canOpen(user, path)) return <>{children}</>;
  return (
    <main className="mx-auto max-w-xl p-4 sm:p-8">
      <EmptyState
        icon={Lock}
        title={t('access.title')}
        body={t('access.body')}
        action={{ label: t('access.home'), onClick: () => navigate('/') }}
      />
    </main>
  );
}
