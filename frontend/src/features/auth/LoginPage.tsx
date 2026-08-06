import { Store } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/features/auth/useAuth';

interface LocationState {
  from?: { pathname?: string };
}

/**
 * Login — phone + password against the host tenant's SimpleJWT endpoint.
 *
 * The tenant comes from the subdomain the page is served from, so there is
 * no shop picker here; a user logging in on the wrong subdomain simply has
 * no account.
 */
export function LoginPage() {
  const { isAuthenticated, isRestoring, isLoggingIn, loginError, signIn } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  if (isAuthenticated) {
    const from = (location.state as LocationState | null)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void signIn(phone.trim(), password)
      .then(() => navigate('/', { replace: true }))
      .catch(() => {
        // Failure is already surfaced via loginError from the mutation.
      });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="flex w-full max-w-sm flex-col items-center">
        <div className="mb-4 flex w-full justify-end">
          <LanguageToggle />
        </div>
        <div className="mb-6 flex flex-col items-center gap-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Store className="h-6 w-6" />
          </span>
          <span className="text-2xl font-bold tracking-tight">दोकान</span>
        </div>

        <Card className="w-full">
          <CardHeader className="space-y-1 pb-4 text-center">
            <CardTitle className="text-xl">{t('auth.title')}</CardTitle>
            <CardDescription>{t('auth.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <Input
                label={t('auth.phone')}
                name="phone"
                inputMode="tel"
                autoComplete="username"
                autoFocus
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98XXXXXXXX"
              />
              <Input
                label={t('auth.password')}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {loginError ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {loginError}
                </p>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={isLoggingIn || isRestoring}
              >
                {isLoggingIn ? t('auth.signingIn') : t('auth.signIn')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
