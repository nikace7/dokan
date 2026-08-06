import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { discardException, summarizeOp } from '@/lib/offline/conflicts';
import type { QueuedSaleOp } from '@/lib/offline/db';
import { useSyncStore } from '@/lib/offline/sync';

/**
 * Offline/sync status for the billing screen. Three states the cashier
 * must see: offline (queued bills will sync), syncing, and failed bills
 * that need a human decision (server rejected them at sync time).
 */
export function SyncStatusBanner() {
  const { t } = useTranslation();
  const { online, syncing, pendingCount, failed } = useSyncStore();
  const [showExceptions, setShowExceptions] = useState(false);

  if (online && !syncing && pendingCount === 0 && failed.length === 0) {
    return null;
  }

  return (
    <div className="lg:col-span-2">
      {!online || pendingCount > 0 || syncing ? (
        <p role="status" className="mb-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {online
            ? syncing
              ? t('billing.sync.syncing', { count: pendingCount })
              : t('billing.sync.queued', { count: pendingCount })
            : t('billing.sync.offlineQueued', { count: pendingCount })}
        </p>
      ) : null}

      {failed.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-amber-900">
              {t('billing.sync.failed', { count: failed.length })}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setShowExceptions((s) => !s)}>
              {showExceptions ? t('billing.sync.hide') : t('billing.sync.review')}
            </Button>
          </div>
          {showExceptions ? (
            <ul className="mt-2 space-y-2">
              {failed.map((op) => (
                <ExceptionRow key={op.seq} op={op} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ExceptionRow({ op }: { op: QueuedSaleOp }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const discard = async () => {
    setDiscarding(true);
    await discardException(op.seq ?? -1);
  };

  return (
    <li className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-medium">{op.localRef}</span>
          <span className="ml-2 text-slate-500">
            {summarizeOp(op)} ·{' '}
            {t('billing.sync.queuedAt', { time: new Date(op.enqueuedAt).toLocaleString() })}
          </span>
        </div>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-slate-600">{t('billing.sync.discardConfirm')}</span>
            <Button variant="danger" size="sm" disabled={discarding} onClick={() => void discard()}>
              {discarding ? t('billing.sync.discarding') : t('billing.sync.discard')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              {t('billing.sync.keep')}
            </Button>
          </span>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            {t('billing.sync.discardEllipsis')}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-red-700">
        {t('billing.sync.serverSaid', { message: op.lastError })}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{t('billing.sync.failedExplain')}</p>
    </li>
  );
}
