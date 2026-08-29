import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { StoreBanner } from '@/features/settings/api';

const MAX_BANNERS = 5;

interface BannersEditorProps {
  value: StoreBanner[];
  onChange: (banners: StoreBanner[]) => void;
}

/**
 * Promo-banner list editor for the online store. Each banner is a small card
 * on the storefront (title + text + optional call-to-action link); the order
 * here is the order on the site.
 */
export function BannersEditor({ value, onChange }: BannersEditorProps) {
  const { t } = useTranslation();

  const update = (index: number, patch: Partial<StoreBanner>) => {
    onChange(value.map((banner, i) => (i === index ? { ...banner, ...patch } : banner)));
  };

  return (
    <div className="flex flex-col gap-3">
      {value.map((banner, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('settings.store.banners.item', { index: index + 1 })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              {t('settings.store.banners.remove')}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              label={t('settings.store.banners.title')}
              value={banner.title}
              onChange={(event) => update(index, { title: event.target.value })}
            />
            <Input
              label={t('settings.store.banners.text')}
              value={banner.text}
              onChange={(event) => update(index, { text: event.target.value })}
            />
            <Input
              label={t('settings.store.banners.ctaText')}
              value={banner.cta_text}
              onChange={(event) => update(index, { cta_text: event.target.value })}
            />
            <Input
              label={t('settings.store.banners.ctaLink')}
              value={banner.cta_link}
              placeholder={t('settings.store.banners.ctaLinkHint')}
              onChange={(event) => update(index, { cta_link: event.target.value })}
            />
          </div>
        </div>
      ))}
      {value.length < MAX_BANNERS ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange([...value, { title: '', text: '', cta_text: '', cta_link: '' }])
            }
          >
            {t('settings.store.banners.add')}
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('settings.store.banners.help')}</p>
    </div>
  );
}
