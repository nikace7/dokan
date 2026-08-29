import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { updateStoreSettings } from '@/features/settings/api';
import type { StoreBanner, StoreSettings } from '@/features/settings/api';
import { BannersEditor } from '@/features/settings/BannersEditor';
import { ApiError } from '@/lib/api/client';

interface PromotionsForm {
  popup_enabled: boolean;
  popup_title: string;
  popup_text: string;
  popup_cta_text: string;
  popup_cta_link: string;
  banners: StoreBanner[];
}

function toForm(settings: StoreSettings): PromotionsForm {
  return {
    popup_enabled: settings.popup_enabled,
    popup_title: settings.popup_title,
    popup_text: settings.popup_text,
    popup_cta_text: settings.popup_cta_text,
    popup_cta_link: settings.popup_cta_link,
    banners: settings.banners,
  };
}

/**
 * The storefront's attention layer: a once-per-visitor offer popup and the
 * promo banner cards under the hero. Saved independently of the main content
 * form so a banner tweak never touches the hero copy.
 */
export function StorePromotionsCard({ settings }: { settings: StoreSettings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PromotionsForm>(() => toForm(settings));
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setForm(toForm(settings));
  }, [settings]);

  const mutation = useMutation({
    mutationFn: updateStoreSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData(['store', 'settings'], updated);
      setForm(toForm(updated));
      setFormError(null);
      setStatusMessage(t('settings.saved'));
    },
    onError: (error) =>
      setFormError(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : t('settings.saveError'),
      ),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setFormError(null);
    const banners = form.banners
      .map((banner) => ({
        title: banner.title.trim(),
        text: banner.text.trim(),
        cta_text: banner.cta_text.trim(),
        cta_link: banner.cta_link.trim(),
      }))
      .filter((banner) => banner.title !== '' || banner.text !== '');
    mutation.mutate({
      popup_enabled: form.popup_enabled,
      popup_title: form.popup_title.trim(),
      popup_text: form.popup_text.trim(),
      popup_cta_text: form.popup_cta_text.trim(),
      popup_cta_link: form.popup_cta_link.trim(),
      banners,
    });
  }

  return (
    <Card title={t('settings.store.promotions.title')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={form.popup_enabled}
            onChange={(event) => setForm({ ...form, popup_enabled: event.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          {t('settings.store.popup.enable')}
        </label>

        {form.popup_enabled ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t('settings.store.popup.title')}
              value={form.popup_title}
              onChange={(event) => setForm({ ...form, popup_title: event.target.value })}
            />
            <Input
              label={t('settings.store.popup.text')}
              value={form.popup_text}
              onChange={(event) => setForm({ ...form, popup_text: event.target.value })}
            />
            <Input
              label={t('settings.store.popup.ctaText')}
              value={form.popup_cta_text}
              onChange={(event) => setForm({ ...form, popup_cta_text: event.target.value })}
            />
            <Input
              label={t('settings.store.popup.ctaLink')}
              value={form.popup_cta_link}
              placeholder={t('settings.store.popup.ctaLinkHint')}
              onChange={(event) => setForm({ ...form, popup_cta_link: event.target.value })}
            />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t('settings.store.popup.help')}</p>

        <h3 className="border-t border-border pt-4 text-sm font-medium">
          {t('settings.store.banners.heading')}
        </h3>
        <BannersEditor value={form.banners} onChange={(banners) => setForm({ ...form, banners })} />

        {statusMessage ? (
          <p
            role="status"
            className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground"
          >
            {statusMessage}
          </p>
        ) : null}
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
  );
}
