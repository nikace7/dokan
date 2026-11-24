import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { closeCashSession, getCurrentCashSession, openCashSession } from '@/features/payments/api';
import { ApiError } from '@/lib/api/client';
import { formatBaseMoney, formatNpr, parseAmount, toPaisa, useMoneyDisplay } from '@/lib/money';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { cn } from '@/lib/utils';

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

/** Base currency, like the amount typed next to it. */
function money(paisa: number | null): string {
  return paisa === null ? '—' : formatBaseMoney(paisa);
}

export function CashSessionPanel() {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [openingFloat, setOpeningFloat] = useState('');
  const [openingNote, setOpeningNote] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState<string | null>(null);
  useMoneyDisplay();
  const query = useQuery({
    queryKey: ['payments', 'cash-session', workspace.branchId],
    queryFn: () => getCurrentCashSession(workspace.branchId ?? ''),
    enabled: Boolean(workspace.branchId),
  });
  const session = query.data?.session ?? null;
  const countedPaisa = parseAmount(countedCash);
  const expectedPaisa = session?.expected_cash == null ? null : toPaisa(session.expected_cash);
  const differencePaisa =
    countedPaisa === null || expectedPaisa === null ? null : countedPaisa - expectedPaisa;

  const openMutation = useMutation({
    mutationFn: () =>
      openCashSession(workspace.branchId ?? '', openingFloat.trim(), openingNote.trim()),
    onSuccess: () => {
      setOpeningFloat('');
      setOpeningNote('');
      setError(null);
      setMessageText(t('payments.cashSession.openedMessage'));
      void queryClient.invalidateQueries({ queryKey: ['payments', 'cash-session'] });
    },
    onError: (err) => setError(message(err, t('payments.cashSession.openError'))),
  });
  const closeMutation = useMutation({
    mutationFn: () => closeCashSession(session?.id ?? '', countedCash.trim()),
    onSuccess: (closed) => {
      setCountedCash('');
      setError(null);
      setMessageText(
        t('payments.cashSession.closedMessage', {
          variance: closed.variance == null ? '—' : formatNpr(closed.variance),
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ['payments', 'cash-session'] });
    },
    onError: (err) => setError(message(err, t('payments.cashSession.closeError'))),
  });

  if (!workspace.branchId) {
    return (
      <Card title={t('payments.cashSession.title')}>
        <p className="text-sm text-warning">{t('payments.cashSession.selectBranch')}</p>
      </Card>
    );
  }

  function open(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openingFloat.trim()) {
      setError(t('payments.cashSession.floatRequired'));
      return;
    }
    openMutation.mutate();
  }

  async function close(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (countedPaisa === null) {
      setError(t('payments.cashSession.countedRequired'));
      return;
    }
    setError(null);
    // Sales since the page opened change what the drawer should hold.
    const latest = await query.refetch();
    if (latest.isSuccess && latest.data.session) setIsConfirming(true);
  }

  return (
    <Card title={t('payments.cashSession.title')}>
      {query.isFetching ? (
        <p className="text-sm text-muted-foreground">{t('payments.cashSession.loading')}</p>
      ) : null}
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {message(query.error, t('payments.cashSession.loadError'))}
        </p>
      ) : null}
      {messageText ? <p className="mb-3 text-sm text-success">{messageText}</p> : null}
      {session ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <dl className="grid gap-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t('payments.cashSession.opened')}</dt>
              <dd>{session.opened_by_name || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('payments.cashSession.openingFloat')}</dt>
              <dd>{formatNpr(session.opening_float)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('payments.cashSession.expectedCash')}</dt>
              <dd>{session.expected_cash == null ? '—' : formatNpr(session.expected_cash)}</dd>
            </div>
          </dl>
          <form onSubmit={(event) => void close(event)} className="flex flex-wrap items-end gap-2">
            <Input
              label={t('payments.cashSession.countedCash')}
              type="number"
              min="0"
              step="0.01"
              value={countedCash}
              onChange={(event) => setCountedCash(event.target.value)}
            />
            <Button type="submit" disabled={closeMutation.isPending || query.isFetching}>
              {closeMutation.isPending
                ? t('payments.cashSession.closing')
                : t('payments.cashSession.close')}
            </Button>
          </form>
          <ConfirmDialog
            danger
            open={isConfirming}
            onOpenChange={setIsConfirming}
            title={t('payments.cashSession.confirmTitle')}
            body={t('payments.cashSession.confirmBody')}
            confirmLabel={t('payments.cashSession.close')}
            onConfirm={() => closeMutation.mutate()}
          >
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm tabular-nums">
              <dt className="text-muted-foreground">{t('payments.cashSession.expectedCash')}</dt>
              <dd className="text-right">{money(expectedPaisa)}</dd>
              <dt className="text-muted-foreground">{t('payments.cashSession.countedCash')}</dt>
              <dd className="text-right">{money(countedPaisa)}</dd>
              <dt className="font-semibold">{t('payments.cashSession.difference')}</dt>
              <dd className={cn('text-right font-semibold', differencePaisa && 'text-destructive')}>
                {money(differencePaisa)}
              </dd>
            </dl>
          </ConfirmDialog>
        </div>
      ) : (
        <form onSubmit={open} className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <Input
            label={t('payments.cashSession.openingFloatLabel')}
            type="number"
            min="0"
            step="0.01"
            value={openingFloat}
            onChange={(event) => setOpeningFloat(event.target.value)}
          />
          <Input
            label={t('common.note')}
            value={openingNote}
            onChange={(event) => setOpeningNote(event.target.value)}
          />
          <Button type="submit" disabled={openMutation.isPending}>
            {openMutation.isPending
              ? t('payments.cashSession.opening')
              : t('payments.cashSession.open')}
          </Button>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
