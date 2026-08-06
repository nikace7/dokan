import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { parseImpersonationClaims, setAccessToken } from '@/lib/auth/tokens';

export function SupportLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const access = params.get('access');
    window.history.replaceState(null, '', '/support-login');
    const claims = access ? parseImpersonationClaims(access) : null;
    if (!access || !claims || claims.exp <= Math.floor(Date.now() / 1000)) {
      setError(t('support.login.invalid'));
      return;
    }
    setAccessToken(access);
    navigate('/', { replace: true });
  }, [navigate, t]);

  return (
    <main className="mx-auto max-w-md p-6">
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : (
        <p role="status" className="text-sm text-slate-600">
          {t('support.login.opening')}
        </p>
      )}
    </main>
  );
}
