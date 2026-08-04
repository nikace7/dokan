import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { closeCashSession, getCurrentCashSession, openCashSession } from '@/features/payments/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';
import { useWorkspace } from '@/features/settings/useWorkspace';

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

export function CashSessionPanel() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [openingFloat, setOpeningFloat] = useState('');
  const [openingNote, setOpeningNote] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState<string | null>(null);
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
      setMessageText('Cash session opened.');
      void queryClient.invalidateQueries({ queryKey: ['payments', 'cash-session'] });
    },
    onError: (err) => setError(message(err, 'Could not open the cash session.')),
  });
  const closeMutation = useMutation({
    mutationFn: () => closeCashSession(session?.id ?? '', countedCash.trim()),
    onSuccess: (closed) => {
      setCountedCash('');
      setError(null);
      setMessageText(
        `Cash session closed. Variance: ${closed.variance == null ? '—' : formatNpr(closed.variance)}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['payments', 'cash-session'] });
    },
    onError: (err) => setError(message(err, 'Could not close the cash session.')),
  });

  if (!workspace.branchId) {
    return (
      <Card title="Cash session / क्यास सेसन">
        <p className="text-sm text-amber-800">
          Select an active branch before managing the cash drawer.
        </p>
      </Card>
    );
  }

  function open(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openingFloat.trim()) {
      setError('Opening float is required.');
      return;
    }
    openMutation.mutate();
  }

  function close(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!countedCash.trim()) {
      setError('Counted cash is required.');
      return;
    }
    closeMutation.mutate();
  }

  return (
    <Card title="Cash session / क्यास सेसन">
      {query.isFetching ? <p className="text-sm text-slate-500">Loading drawer…</p> : null}
      {query.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {message(query.error, 'Could not load the cash session.')}
        </p>
      ) : null}
      {messageText ? <p className="mb-3 text-sm text-green-700">{messageText}</p> : null}
      {session ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <dl className="grid gap-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Opened</dt>
              <dd>{session.opened_by_name || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Opening float</dt>
              <dd>{formatNpr(session.opening_float)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Expected cash</dt>
              <dd>{session.expected_cash == null ? '—' : formatNpr(session.expected_cash)}</dd>
            </div>
          </dl>
          <form onSubmit={close} className="flex flex-wrap items-end gap-2">
            <Input
              label="Counted cash (NPR)"
              type="number"
              min="0"
              step="0.01"
              value={countedCash}
              onChange={(event) => setCountedCash(event.target.value)}
            />
            <Button type="submit" disabled={closeMutation.isPending}>
              {closeMutation.isPending ? 'Closing…' : 'Close session'}
            </Button>
          </form>
        </div>
      ) : (
        <form onSubmit={open} className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <Input
            label="Opening float (NPR)"
            type="number"
            min="0"
            step="0.01"
            value={openingFloat}
            onChange={(event) => setOpeningFloat(event.target.value)}
          />
          <Input
            label="Note"
            value={openingNote}
            onChange={(event) => setOpeningNote(event.target.value)}
          />
          <Button type="submit" disabled={openMutation.isPending}>
            {openMutation.isPending ? 'Opening…' : 'Open session'}
          </Button>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
