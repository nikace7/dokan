import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * Compact EN / ने segmented switch. `changeLanguage` persists the choice to
 * localStorage (detector cache) and the html `lang` attribute follows via the
 * listener in `lib/i18n`.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const current = i18n.language.startsWith('ne') ? 'ne' : 'en';

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className={cn('flex items-center', className)}
    >
      <Languages className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden />
      {(
        [
          ['en', t('language.english')],
          ['ne', t('language.nepali')],
        ] as const
      ).map(([lng, label]) => (
        <button
          key={lng}
          type="button"
          aria-pressed={current === lng}
          onClick={() => void i18n.changeLanguage(lng)}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
            current === lng
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
