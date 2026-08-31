import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  changePassword,
  confirmLoginOtp,
  disableLoginOtp,
  getLoginOtpStatus,
  listAuthSessions,
  requestLoginOtp,
  revokeAuthSession,
  revokeOtherAuthSessions,
} from '@/features/auth/api';
import type { AuthSession, LoginOtpStatus } from '@/features/auth/api';
import { ApiError } from '@/lib/api/client';

const SESSIONS_KEY = ['auth', 'sessions'] as const;
const OTP_KEY = ['auth', 'login-otp'] as const;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function seenAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

/** Self-service password, login-code, and registered-device controls. */
export function SecurityPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: listAuthSessions, retry: false });
  const otpStatus = useQuery({ queryKey: OTP_KEY, queryFn: getLoginOtpStatus, retry: false });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function mutationError(error: unknown) {
    setNotice(null);
    setFormError(errorMessage(error, t('security.failed')));
  }

  const passwordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setFormError(null);
      setNotice(t('security.password.changed'));
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
    onError: mutationError,
  });

  const requestOtpMutation = useMutation({
    mutationFn: requestLoginOtp,
    onSuccess: () => {
      setOtpRequested(true);
      setFormError(null);
      setNotice(t('security.otp.sent'));
    },
    onError: mutationError,
  });

  const confirmOtpMutation = useMutation({
    mutationFn: confirmLoginOtp,
    onSuccess: (result) => {
      queryClient.setQueryData<LoginOtpStatus>(OTP_KEY, result);
      setOtpRequested(false);
      setOtpCode('');
      setFormError(null);
      setNotice(t('security.otp.enabled'));
    },
    onError: mutationError,
  });

  const disableOtpMutation = useMutation({
    mutationFn: disableLoginOtp,
    onSuccess: (result) => {
      queryClient.setQueryData<LoginOtpStatus>(OTP_KEY, result);
      setDisablePassword('');
      setFormError(null);
      setNotice(t('security.otp.disabled'));
    },
    onError: mutationError,
  });

  const revokeMutation = useMutation({
    mutationFn: revokeAuthSession,
    onSuccess: (revoked) => {
      queryClient.setQueryData<AuthSession[]>(SESSIONS_KEY, (rows) =>
        (rows ?? []).map((row) => (row.id === revoked.id ? { ...row, ...revoked } : row)),
      );
      setFormError(null);
      setNotice(t('security.sessions.revoked'));
    },
    onError: mutationError,
  });

  const revokeOthersMutation = useMutation({
    mutationFn: revokeOtherAuthSessions,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      setFormError(null);
      setNotice(t('security.sessions.othersRevoked'));
    },
    onError: mutationError,
  });

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (newPassword !== confirmPassword) {
      setFormError(t('auth.reset.passwordMismatch'));
      return;
    }
    passwordMutation.mutate({
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <PageHeader title={t('security.title')} description={t('security.description')} />
      {notice ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {notice}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <Card title={t('security.password.title')}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitPassword}>
          <Input
            label={t('security.password.current')}
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <span className="hidden sm:block" />
          <Input
            label={t('auth.reset.newPassword')}
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
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
          <div className="sm:col-span-2">
            <Button type="submit" loading={passwordMutation.isPending}>
              {t('security.password.submit')}
            </Button>
          </div>
        </form>
      </Card>

      <Card title={t('security.otp.title')}>
        {otpStatus.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : otpStatus.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(otpStatus.error, t('security.failed'))}
          </p>
        ) : otpStatus.data?.enabled ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              disableOtpMutation.mutate(disablePassword);
            }}
          >
            <p className="text-sm text-muted-foreground">{t('security.otp.enabledHelp')}</p>
            <Input
              label={t('security.password.current')}
              type="password"
              autoComplete="current-password"
              required
              value={disablePassword}
              onChange={(event) => setDisablePassword(event.target.value)}
            />
            <Button type="submit" variant="secondary" loading={disableOtpMutation.isPending}>
              {t('security.otp.disable')}
            </Button>
          </form>
        ) : otpRequested ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              confirmOtpMutation.mutate(otpCode);
            }}
          >
            <Input
              label={t('auth.verificationCode')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              required
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ''))}
            />
            <Button type="submit" loading={confirmOtpMutation.isPending}>
              {t('security.otp.confirm')}
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('security.otp.disabledHelp')}</p>
            <Button
              type="button"
              onClick={() => requestOtpMutation.mutate()}
              loading={requestOtpMutation.isPending}
            >
              {t('security.otp.enable')}
            </Button>
          </div>
        )}
      </Card>

      <Card
        title={t('security.sessions.title')}
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => revokeOthersMutation.mutate()}
            loading={revokeOthersMutation.isPending}
          >
            {t('security.sessions.revokeOthers')}
          </Button>
        }
      >
        {sessions.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : sessions.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(sessions.error, t('security.failed'))}
          </p>
        ) : (
          <ul className="divide-y">
            {(sessions.data ?? [])
              .filter((session) => !session.revoked_at)
              .map((session) => (
                <li
                  key={session.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {session.device_name}{' '}
                      {session.current ? (
                        <span className="text-xs text-primary">
                          ({t('security.sessions.current')})
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('security.sessions.lastSeen', { date: seenAt(session.last_seen_at) })}
                    </p>
                  </div>
                  {!session.current ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t('security.sessions.revokeNamed', { name: session.device_name })}
                      onClick={() => revokeMutation.mutate(session.id)}
                      loading={revokeMutation.isPending && revokeMutation.variables === session.id}
                    >
                      {t('security.sessions.revoke')}
                    </Button>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
