import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { getStoreSettings, updateStoreSettings } from '@/features/settings/api';
import type { StoreSettings } from '@/features/settings/api';
import { useAuth } from '@/features/auth/useAuth';
import { ApiError } from '@/lib/api/client';
import { hasPermission } from '@/lib/permissions';

type StoreForm = {
  hero_title: string;
  hero_subtitle: string;
  announcement: string;
  offer_text: string;
  offer_discount_pct: string;
  currency: StoreSettings['currency'];
};

function toForm(settings: StoreSettings): StoreForm {
  return {
    hero_title: settings.hero_title,
    hero_subtitle: settings.hero_subtitle,
    announcement: settings.announcement,
    offer_text: settings.offer_text,
    offer_discount_pct: settings.offer_discount_pct ?? '',
    currency: settings.currency,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * Tenant admin's online-store control panel: website copy, announcement,
 * store-wide offer, and the website price currency. The address and the
 * design template stay platform-admin decisions and are shown read-only.
 */
export function OnlineStorePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManage = hasPermission(user, 'settings.manage');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['store', 'settings'],
    queryFn: getStoreSettings,
    enabled: canManage,
    retry: false,
  });
  const [form, setForm] = useState<StoreForm | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setForm(toForm(query.data));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: updateStoreSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(['store', 'settings'], settings);
      setForm(toForm(settings));
      setFormError(null);
      setStatusMessage(t('settings.saved'));
    },
    onError: (error) => setFormError(errorMessage(error, t('settings.saveError'))),
  });

  if (!canManage) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <Card title={t('settings.store.title')}>
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

  const settings = query.data;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentForm = form;
    if (!currentForm) return;
    const pct = currentForm.offer_discount_pct.trim();
    if (pct !== '' && (Number.isNaN(Number(pct)) || Number(pct) <= 0 || Number(pct) > 90)) {
      setFormError(t('settings.store.discountInvalid'));
      return;
    }
    setStatusMessage(null);
    setFormError(null);
    mutation.mutate({
      hero_title: currentForm.hero_title.trim(),
      hero_subtitle: currentForm.hero_subtitle.trim(),
      announcement: currentForm.announcement.trim(),
      offer_text: currentForm.offer_text.trim(),
      offer_discount_pct: pct === '' ? null : pct,
      currency: currentForm.currency,
    });
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {statusMessage ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {statusMessage}
        </p>
      ) : null}

      <Card title={t('settings.store.status.title')}>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <span className="block text-xs text-muted-foreground">
              {t('settings.store.status.address')}
            </span>
            {settings.store_url ? (
              <a
                className="font-medium text-primary hover:underline"
                href={settings.store_url}
                target="_blank"
                rel="noreferrer"
              >
                {settings.store_url.replace(/^https:\/\//, '')}
              </a>
            ) : (
              <span className="font-medium text-muted-foreground">
                {t('settings.store.status.noAddress')}
              </span>
            )}
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">
              {t('settings.store.status.template')}
            </span>
            <span className="font-medium capitalize">{settings.template}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">
              {t('settings.store.status.service')}
            </span>
            <span className="font-medium">
              {settings.ecommerce_enabled
                ? t('settings.store.status.serviceOn')
                : t('settings.store.status.serviceOff')}
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('settings.store.status.help')}</p>
      </Card>

      <Card title={t('settings.store.content.title')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label={t('settings.store.content.heroTitle')}
            value={form.hero_title}
            placeholder={settings.shopfront_subdomain ? '' : t('settings.store.content.heroTitleHint')}
            onChange={(event) => setForm({ ...form, hero_title: event.target.value })}
          />
          <Input
            label={t('settings.store.content.heroSubtitle')}
            value={form.hero_subtitle}
            onChange={(event) => setForm({ ...form, hero_subtitle: event.target.value })}
          />
          <Input
            label={t('settings.store.content.announcement')}
            value={form.announcement}
            onChange={(event) => setForm({ ...form, announcement: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t('settings.store.content.help')}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t('settings.store.offer.text')}
              value={form.offer_text}
              placeholder={t('settings.store.offer.textHint')}
              onChange={(event) => setForm({ ...form, offer_text: event.target.value })}
            />
            <Input
              label={t('settings.store.offer.discount')}
              type="number"
              min="0"
              max="90"
              step="0.01"
              value={form.offer_discount_pct}
              onChange={(event) => setForm({ ...form, offer_discount_pct: event.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.store.offer.help')}</p>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('settings.store.currency')}
            <select
              value={form.currency}
              onChange={(event) =>
                setForm({ ...form, currency: event.target.value as StoreForm['currency'] })
              }
              className={`${selectClasses} font-normal`}
            >
              <option value="NPR">{t('settings.profile.currencyNpr')}</option>
              <option value="INR">{t('settings.profile.currencyInr')}</option>
            </select>
            <span className="text-xs font-normal text-muted-foreground">
              {t('settings.store.currencyHelp')}
            </span>
          </label>

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
    </main>
  );
}
