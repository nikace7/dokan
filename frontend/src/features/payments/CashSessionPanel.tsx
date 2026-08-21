import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { closeCashSession, getCurrentCashSession, openCashSession } from '@/features/payments/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr, useMoneyDisplay } from '@/lib/money';
import { useWorkspace } from '@/features/settings/useWorkspace';

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

export function CashSessionPanel() {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [openingFloat, setOpeningFloat] = useState('');
  const [openingNote, setOpeningNote] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState<string | null>(null);
  useMoneyDisplay();
  const query = useQuery({
    queryKey: ['payments', 'cash-session', workspace.branchId],
    queryFn: () => getCurrentCashSession(workspace.branchId ?? ''),
    enabled: Boolean(workspace.branchId),
  });
  const session = query.data?.session ?? null;

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

  function close(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!countedCash.trim()) {
      setError(t('payments.cashSession.countedRequired'));
      return;
    }
    closeMutation.mutate();
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
          <form onSubmit={close} className="flex flex-wrap items-end gap-2">
            <Input
              label={t('payments.cashSession.countedCash')}
              type="number"
              min="0"
              step="0.01"
              value={countedCash}
              onChange={(event) => setCountedCash(event.target.value)}
            />
            <Button type="submit" disabled={closeMutation.isPending}>
              {closeMutation.isPending
                ? t('payments.cashSession.closing')
                : t('payments.cashSession.close')}
            </Button>
          </form>
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
