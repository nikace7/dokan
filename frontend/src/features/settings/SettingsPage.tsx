import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { getTenantSettings, updateTenantSettings } from '@/features/settings/api';
import type { TenantSettings } from '@/features/settings/api';
import { useAuth } from '@/features/auth/useAuth';
import { ApiError } from '@/lib/api/client';
import { hasPermission } from '@/lib/permissions';

type SettingsForm = {
  name: string;
  name_np: string;
  legal_name: string;
  pan_vat_no: string;
  vat_registered: boolean;
  calendar_pref: TenantSettings['calendar_pref'];
  locale: TenantSettings['locale'];
  currency: TenantSettings['currency'];
};

function toForm(settings: TenantSettings): SettingsForm {
  return {
    name: settings.name,
    name_np: settings.name_np ?? '',
    legal_name: settings.legal_name ?? '',
    pan_vat_no: settings.pan_vat_no ?? '',
    vat_registered: settings.vat_registered,
    calendar_pref: settings.calendar_pref,
    locale: settings.locale,
    currency: settings.currency,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** Owner-facing tenant profile and presentation settings. */
export function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManage = hasPermission(user, 'settings.manage');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['tenant', 'settings'],
    queryFn: getTenantSettings,
    enabled: canManage,
    retry: false,
  });
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setForm(toForm(query.data));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: updateTenantSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(['tenant', 'settings'], settings);
      setForm(toForm(settings));
      setFormError(null);
      setStatusMessage(t('settings.saved'));
    },
    onError: (error) => setFormError(errorMessage(error, t('settings.saveError'))),
  });

  if (!canManage) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <Card title={t('settings.title')}>
          <p className="text-sm text-muted-foreground">{t('settings.ownerOnly')}</p>
        </Card>
      </main>
    );
  }

  if (query.isPending) {
    return (
      <main className="mx-auto max-w-3xl p-4 text-sm text-muted-foreground">
        {t('settings.loading')}
      </main>
    );
  }

  if (query.isError || !query.data || !form) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage(query.error, t('settings.saveError'))}
        </p>
      </main>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentForm = form;
    if (!currentForm) return;
    if (!currentForm.name.trim()) {
      setFormError(t('settings.nameRequired'));
      return;
    }
    setStatusMessage(null);
    setFormError(null);
    mutation.mutate({
      ...currentForm,
      name: currentForm.name.trim(),
      name_np: currentForm.name_np.trim() || null,
      legal_name: currentForm.legal_name.trim() || null,
      pan_vat_no: currentForm.pan_vat_no.trim() || null,
    });
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {statusMessage ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {statusMessage}
        </p>
      ) : null}
      <Card title={t('settings.profile.title')}>
        <div className="mb-4 grid gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-3">
          <div>
            <span className="block text-xs text-muted-foreground">
              {t('settings.profile.subdomain')}
            </span>
            <span className="font-medium">{query.data.slug}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">{t('settings.profile.plan')}</span>
            <span className="font-medium">{query.data.plan_code}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">
              {t('settings.profile.timezone')}
            </span>
            <span className="font-medium">{query.data.timezone}</span>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t('settings.profile.shopName')}
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Input
              label={t('settings.profile.shopNameNp')}
              value={form.name_np}
              onChange={(event) => setForm({ ...form, name_np: event.target.value })}
            />
            <Input
              label={t('settings.profile.legalName')}
              value={form.legal_name}
              onChange={(event) => setForm({ ...form, legal_name: event.target.value })}
            />
            <Input
              label={t('settings.profile.panVat')}
              value={form.pan_vat_no}
              onChange={(event) => setForm({ ...form, pan_vat_no: event.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.vat_registered}
              onChange={(event) => setForm({ ...form, vat_registered: event.target.checked })}
              className="accent-primary"
            />
            {t('settings.profile.vatRegistered')}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('settings.profile.calendarPref')}
              <select
                value={form.calendar_pref}
                onChange={(event) =>
                  setForm({
                    ...form,
                    calendar_pref: event.target.value as SettingsForm['calendar_pref'],
                  })
                }
                className={`${selectClasses} font-normal`}
              >
                <option value="BS">{t('settings.profile.calBs')}</option>
                <option value="AD">{t('settings.profile.calAd')}</option>
                <option value="BOTH">{t('settings.profile.calBoth')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('settings.profile.locale')}
              <select
                value={form.locale}
                onChange={(event) =>
                  setForm({ ...form, locale: event.target.value as SettingsForm['locale'] })
                }
                className={`${selectClasses} font-normal`}
              >
                <option value="np">{t('settings.profile.localeNp')}</option>
                <option value="en">{t('settings.profile.localeEn')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('settings.profile.currency')}
              <select
                value={form.currency}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value as SettingsForm['currency'] })
                }
                className={`${selectClasses} font-normal`}
              >
                <option value="NPR">{t('settings.profile.currencyNpr')}</option>
                <option value="INR">{t('settings.profile.currencyInr')}</option>
              </select>
              <span className="text-xs font-normal text-muted-foreground">
                {t('settings.profile.currencyHelp')}
              </span>
            </label>
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.saving') : t('settings.profile.save')}
            </Button>
          </div>
        </form>
      </Card>
      {hasPermission(user, 'user.manage') ? (
        <Card title={t('settings.staffCard.title')}>
          <p className="mb-3 text-sm text-muted-foreground">{t('settings.staffCard.help')}</p>
          <Button asChild>
            <Link to="/settings/staff">{t('settings.staffCard.manage')}</Link>
          </Button>
        </Card>
      ) : null}
      {user?.is_owner ? (
        <Card title={t('settings.supportCard.title')}>
          <p className="mb-3 text-sm text-muted-foreground">{t('settings.supportCard.help')}</p>
          <Button asChild variant="secondary">
            <Link to="/settings/support-access">{t('settings.supportCard.viewLog')}</Link>
          </Button>
        </Card>
      ) : null}
    </main>
  );
}
