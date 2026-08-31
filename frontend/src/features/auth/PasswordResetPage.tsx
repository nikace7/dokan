import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import brandMark from '@/assets/brand-mark.webp';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { confirmPasswordReset, requestPasswordReset } from '@/features/auth/api';
import { ApiError } from '@/lib/api/client';

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

/** Enumeration-safe two-step SMS password recovery. */
export function PasswordResetPage() {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await requestPasswordReset({ phone: phone.trim() });
      setCodeSent(true);
    } catch (caught) {
      setError(message(caught, t('common.networkError')));
    } finally {
      setPending(false);
    }
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError(t('auth.reset.passwordMismatch'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await confirmPasswordReset({
        phone: phone.trim(),
        code,
        new_password: password,
      });
      setComplete(true);
    } catch (caught) {
      setError(message(caught, t('common.networkError')));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <Link to="/login" className="flex items-center gap-2 font-semibold">
            <img src={brandMark} alt="" className="h-9 w-9" />
            mero-pasal.online
          </Link>
          <LanguageToggle />
        </div>
        <Card title={t('auth.reset.title')}>
          {complete ? (
            <div className="space-y-4">
              <p role="status" className="rounded-md bg-accent p-3 text-sm text-accent-foreground">
                {t('auth.reset.complete')}
              </p>
              <Button asChild className="w-full">
                <Link to="/login">{t('auth.reset.backToSignIn')}</Link>
              </Button>
            </div>
          ) : !codeSent ? (
            <form className="space-y-4" onSubmit={sendCode}>
              <p className="text-sm text-muted-foreground">{t('auth.reset.help')}</p>
              <Input
                label={t('auth.phone')}
                inputMode="tel"
                autoComplete="username"
                required
                autoFocus
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="98XXXXXXXX"
              />
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" loading={pending} className="w-full">
                {t('auth.reset.sendCode')}
              </Button>
              <Link className="block text-center text-sm text-primary hover:underline" to="/login">
                {t('auth.reset.backToSignIn')}
              </Link>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={reset}>
              <p role="status" className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                {t('auth.reset.sent')}
              </p>
              <Input
                label={t('auth.verificationCode')}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                required
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
              <Input
                label={t('auth.reset.newPassword')}
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Input
                label={t('auth.reset.confirmPassword')}
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" loading={pending} className="w-full">
                {t('auth.reset.submit')}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}
