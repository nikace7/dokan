import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { PurchaseInvoiceStatus } from '@/features/purchasing/api';
import { cn } from '@/lib/utils';

const STEPS = [
  { status: 'DRAFT', labelKey: 'purchasing.statusDraft' },
  { status: 'CONFIRMED', labelKey: 'purchasing.statusConfirmed' },
] as const;

type StepState = 'done' | 'current' | 'future';

/**
 * Display-only DRAFT → CONFIRMED progress for an expanded purchase invoice.
 * CANCELLED invoices never render this (the page shows the status badge).
 */
export function StatusStepper({ status }: { status: PurchaseInvoiceStatus }) {
  const { t } = useTranslation();
  const currentIndex = status === 'CONFIRMED' ? 1 : 0;

  const stateOf = (index: number): StepState => {
    if (status === 'CONFIRMED' || index < currentIndex) return 'done';
    return index === currentIndex ? 'current' : 'future';
  };

  return (
    <ol
      aria-label={t('purchasing.stepper.aria', { defaultValue: 'Invoice progress' })}
      className="flex items-center"
    >
      {STEPS.map((step, index) => {
        const state = stateOf(index);
        return (
          <li
            key={step.status}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn('flex items-center', index > 0 && 'flex-1')}
          >
            {index > 0 ? (
              <span
                aria-hidden
                className={cn(
                  'mx-2 h-px min-w-4 flex-1',
                  state === 'done' ? 'bg-success' : 'bg-border',
                )}
              />
            ) : null}
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full',
                  state === 'done' && 'bg-success text-success-foreground',
                  state === 'current' && 'border-2 border-primary text-primary',
                  state === 'future' && 'border border-border text-muted-foreground',
                )}
              >
                {state === 'done' ? <Check className="h-3 w-3" /> : null}
                {state === 'current' ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                ) : null}
              </span>
              <span
                className={cn(
                  'text-xs',
                  state === 'future' ? 'text-muted-foreground' : 'font-medium',
                )}
              >
                {t(step.labelKey)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
