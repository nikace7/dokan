import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';
import { serverMessage } from '@/features/billing/cartModel';
import { ApiError } from '@/lib/api/client';
import { hasPermission } from '@/lib/permissions';

/** Why a sale did not go through, with the way out when there is one. */
export function SaleErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!error) return null;
  const isDrawerClosed = error instanceof ApiError && error.code === 'CASH_SESSION_REQUIRED';
  const canOpenDrawer = hasPermission(user, 'cash.manage');
  let message = typeof error === 'string' ? error : serverMessage(error);
  if (isDrawerClosed)
    message = t(canOpenDrawer ? 'billing.errors.drawerClosed' : 'simpleSale.cashSessionRequired');
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
      {isDrawerClosed && canOpenDrawer ? (
        <Link to="/payments" className="ml-1 inline-block py-1 font-semibold underline">
          {t('billing.errors.openDrawer')}
        </Link>
      ) : null}
    </p>
  );
}
