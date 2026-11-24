import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';

interface UnconfirmedSaleNoticeProps {
  retryDisabled?: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}

/**
 * Shown when a sale was sent but no definite answer came back: the server may
 * or may not have saved it. Retrying re-sends the identical bill and key, so
 * it can never be billed twice; discarding needs a deliberate yes.
 */
export function UnconfirmedSaleNotice({
  retryDisabled = false,
  onRetry,
  onDiscard,
}: UnconfirmedSaleNoticeProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // After a reload the page opens at the top, locked, with the reason below.
  useEffect(() => ref.current?.scrollIntoView?.({ block: 'center' }), []);
  return (
    <div
      ref={ref}
      role="alert"
      className="flex flex-col gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <p>{t('billing.unconfirmed.message')}</p>
      <div className="flex gap-2">
        <Button size="lg" className="flex-1" disabled={retryDisabled} onClick={onRetry}>
          {t('billing.unconfirmed.retry')}
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            if (window.confirm(t('billing.unconfirmed.discardConfirm'))) onDiscard();
          }}
        >
          {t('billing.unconfirmed.discard')}
        </Button>
      </div>
    </div>
  );
}
