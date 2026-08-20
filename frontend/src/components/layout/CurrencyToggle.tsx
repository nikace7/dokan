import { Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { useCurrencyStore } from '@/stores/currency';

/**
 * Compact NPR / INR segmented switch — the money twin of LanguageToggle.
 * Persists the viewing preference to localStorage; amounts keep arriving in
 * the tenant's base currency and money.ts converts at the NRB peg.
 */
export function CurrencyToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const display = useCurrencyStore((state) => state.display);
  const setDisplay = useCurrencyStore((state) => state.setDisplay);

  return (
    <div
      role="group"
      aria-label={t('currency.label')}
      className={cn('flex items-center', className)}
    >
      <Coins className="mr-1 h-4 w-4 text-muted-foreground" aria-hidden />
      {(['NPR', 'INR'] as const).map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={display === code}
          onClick={() => setDisplay(code)}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
            display === code
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
