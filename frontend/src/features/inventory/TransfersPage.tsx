import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { PickedVariant } from '@/features/catalog/VariantPicker';
import { VariantPicker } from '@/features/catalog/VariantPicker';
import { useAuth } from '@/features/auth/useAuth';
import {
  cancelTransfer,
  completeTransfer,
  createTransfer,
  listInTransit,
  listTransfers,
  receiveTransfer,
  sendTransfer,
} from '@/features/inventory/api';
import type { StockTransfer, TransferLinePayload } from '@/features/inventory/api';
import type { Branch } from '@/features/settings/api';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { ApiError } from '@/lib/api/client';
import { hasPermission } from '@/lib/permissions';
import { hasPlanFeature } from '@/lib/plans';
export function TransfersPage() {
  const { user, isRestoring } = useAuth();
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const canView = hasPermission(user, 'stock.view');
  const canAdjust = hasPermission(user, 'stock.adjust');
  const planAllows = hasPlanFeature(user, 'multi_branch');
  const enabled = canView && planAllows;
  const transfersQuery = useQuery({
    queryKey: ['inventory', 'transfers'],
    queryFn: listTransfers,
    enabled,
  });
  const transitQuery = useQuery({
    queryKey: ['inventory', 'transfers', 'in-transit'],
    queryFn: listInTransit,
    enabled,
  });
  const transition = useMutation({
    mutationFn: ({
      id,
      action,
      lines,
    }: {
      id: string;
      action: string;
      lines?: TransferLinePayload[];
    }) => {
      if (action === 'send') return sendTransfer(id).then(() => undefined);
      if (action === 'receive') return receiveTransfer(id, lines ?? []).then(() => undefined);
      if (action === 'complete') return completeTransfer(id).then(() => undefined);
      return cancelTransfer(id).then(() => undefined);
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (reason) => setError(message(reason, 'Could not update the transfer.')),
  });
  if (isRestoring || !user) return <PageMessage>Loading…</PageMessage>;
  if (!canView)
    return <PageMessage>You do not have permission to view stock transfers.</PageMessage>;
  if (!planAllows)
    return <PageMessage>Your plan does not include multi-branch transfers.</PageMessage>;
  const transfers = transfersQuery.data?.data ?? [];
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stock transfers / स्टक स्थानान्तरण</h1>
          <p className="text-sm text-slate-500">
            Stock leaves the source when sent and remains in transit until received.
          </p>
        </div>
        <Link className="text-sm text-blue-700 underline" to="/stock">
          Back to stock
        </Link>
      </div>
      {canAdjust ? (
        <TransferCreateCard
          branches={workspace.branches}
          sourceBranch={workspace.branchId}
          onCreated={() =>
            void queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] })
          }
        />
      ) : null}
      <Card title="Currently in transit">
        {transitQuery.isPending ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {transitQuery.data?.length === 0 ? (
          <p className="text-sm text-slate-500">No stock is currently in transit.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {transitQuery.data?.map((row) => (
            <span
              key={row.variant_id}
              className="rounded bg-amber-100 px-2 py-1 text-sm text-amber-900"
            >
              {row.sku}: {row.qty_in_transit}
            </span>
          ))}
        </div>
      </Card>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {transfersQuery.isError ? (
        <p role="alert" className="text-sm text-red-700">
          {message(transfersQuery.error, 'Could not load transfers.')}
        </p>
      ) : null}
      {transfersQuery.data && transfers.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No transfers yet.</p>
        </Card>
      ) : null}
      {transfers.map((transfer) => (
        <TransferCard
          key={transfer.id}
          transfer={transfer}
          canAdjust={canAdjust}
          pending={transition.isPending}
          onAction={(action, lines) => transition.mutate({ id: transfer.id, action, lines })}
        />
      ))}
    </main>
  );
}
function TransferCreateCard({
  branches,
  sourceBranch,
  onCreated,
}: {
  branches: Branch[];
  sourceBranch: string | null;
  onCreated: () => void;
}) {
  const [fromBranch, setFromBranch] = useState('');
  const [toBranch, setToBranch] = useState('');
  const [variant, setVariant] = useState<PickedVariant | null>(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<(TransferLinePayload & { label: string })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const source = fromBranch || sourceBranch || branches[0]?.id || '';
  const destination = toBranch || branches.find((branch) => branch.id !== source)?.id || '';
  const mutation = useMutation({
    mutationFn: createTransfer,
    onSuccess: () => {
      setLines([]);
      setNote('');
      setError(null);
      onCreated();
    },
    onError: (reason) => setError(message(reason, 'Could not create the transfer.')),
  });
  const addLine = () => {
    if (!variant || Number(qty) <= 0)
      return setError('Pick a variant and enter a positive quantity.');
    setLines((current) => [
      ...current.filter((line) => line.variant !== variant.id),
      { variant: variant.id, qty, label: `${variant.itemName} — ${variant.sku}` },
    ]);
    setVariant(null);
    setQty('');
    setError(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!source || !destination || source === destination)
      return setError('Choose two different branches.');
    if (lines.length === 0) return setError('Add at least one transfer line.');
    mutation.mutate({
      from_branch: source,
      to_branch: destination,
      lines: lines.map(({ variant: id, qty: amount }) => ({ variant: id, qty: amount })),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };
  return (
    <Card title="Create transfer">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectBranch
            label="Source branch"
            value={source}
            branches={branches}
            onChange={setFromBranch}
          />
          <SelectBranch
            label="Destination branch"
            value={destination}
            branches={branches.filter((branch) => branch.id !== source)}
            onChange={setToBranch}
          />
        </div>
        {variant ? (
          <p className="rounded bg-blue-50 p-2 text-sm">
            {variant.itemName} — {variant.sku}{' '}
            <button
              type="button"
              className="ml-2 text-blue-700 underline"
              onClick={() => setVariant(null)}
            >
              Change
            </button>
          </p>
        ) : (
          <VariantPicker onPick={setVariant} />
        )}
        <div className="flex gap-2">
          <input
            aria-label="Transfer quantity"
            type="number"
            min="0.001"
            step="0.001"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <Button variant="secondary" onClick={addLine}>
            Add transfer line
          </Button>
        </div>
        {lines.map((line) => (
          <div
            key={line.variant}
            className="flex justify-between rounded bg-slate-50 px-3 py-2 text-sm"
          >
            <span>{line.label}</span>
            <span>{line.qty}</span>
          </div>
        ))}
        <textarea
          aria-label="Transfer note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note (optional)"
          rows={2}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={mutation.isPending}>
          Create transfer
        </Button>
      </form>
    </Card>
  );
}
function SelectBranch({
  label,
  value,
  branches,
  onChange,
}: {
  label: string;
  value: string;
  branches: Branch[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2"
      >
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.code} — {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function TransferCard({
  transfer,
  canAdjust,
  pending,
  onAction,
}: {
  transfer: StockTransfer;
  canAdjust: boolean;
  pending: boolean;
  onAction: (action: string, lines?: TransferLinePayload[]) => void;
}) {
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const receivedLines = transfer.items.flatMap((item) =>
    Number(receipts[item.variant]) > 0
      ? [{ variant: item.variant, qty: receipts[item.variant] }]
      : [],
  );
  return (
    <Card title={`${transfer.status} · ${transfer.created_by_name ?? 'System'}`}>
      <h2 className="text-lg font-semibold">
        {transfer.from_branch_code} → {transfer.to_branch_code}
      </h2>
      {transfer.note ? <p className="text-sm text-slate-500">{transfer.note}</p> : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500">
              <th className="py-2">Item</th>
              <th>SKU</th>
              <th className="text-right">Sent</th>
              <th className="text-right">Received</th>
              {transfer.status === 'SENT' && canAdjust ? (
                <th className="pl-3">Receive now</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {transfer.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="py-2">{item.item_name}</td>
                <td>{item.variant_sku}</td>
                <td className="text-right">{item.qty_sent}</td>
                <td className="text-right">{item.qty_received ?? '0'}</td>
                {transfer.status === 'SENT' && canAdjust ? (
                  <td className="pl-3">
                    <input
                      aria-label={`Receive ${item.variant_sku}`}
                      type="number"
                      min="0"
                      step="0.001"
                      value={receipts[item.variant] ?? ''}
                      onChange={(event) =>
                        setReceipts((current) => ({
                          ...current,
                          [item.variant]: event.target.value,
                        }))
                      }
                      className="w-28 rounded border px-2 py-1"
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canAdjust ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {transfer.status === 'DRAFT' ? (
            <>
              <Button disabled={pending} onClick={() => onAction('send')}>
                Send transfer
              </Button>
              <Button variant="danger" disabled={pending} onClick={() => onAction('cancel')}>
                Cancel draft
              </Button>
            </>
          ) : null}
          {transfer.status === 'SENT' ? (
            <>
              <Button
                disabled={pending || receivedLines.length === 0}
                onClick={() => onAction('receive', receivedLines)}
              >
                Receive entered
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => onAction('complete')}>
                Complete transfer
              </Button>
              <span className="text-xs text-amber-700">
                Completing writes any remaining quantity off as a transfer shortage.
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
function PageMessage({ children }: { children: string }) {
  return (
    <main className="mx-auto max-w-6xl p-4">
      <p role="alert">{children}</p>
    </main>
  );
}
function message(reason: unknown, fallback: string) {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}
