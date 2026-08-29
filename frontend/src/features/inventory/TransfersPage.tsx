import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { TableCell } from '@/components/ui/table';
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
import { cellInputClasses, selectClasses } from '@/features/inventory/ui';
import { ReportTable } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import type { Branch } from '@/features/settings/api';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { hasPermission } from '@/lib/permissions';
import { hasPlanFeature } from '@/lib/plans';
export function TransfersPage() {
  const { t } = useTranslation();
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
    onError: (reason) => setError(message(reason, t('inventory.transfers.updateError'))),
  });
  if (isRestoring || !user) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (!canView) return <PageMessage>{t('inventory.transfers.noPermission')}</PageMessage>;
  if (!planAllows) return <PageMessage>{t('inventory.transfers.planDenied')}</PageMessage>;
  const transfers = transfersQuery.data?.data ?? [];
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4">
      <PageHeader
        title={t('inventory.transfers.title')}
        description={t('inventory.transfers.subtitle')}
        actions={
          <Link className="text-sm text-primary hover:underline" to="/stock">
            {t('inventory.backToStock')}
          </Link>
        }
      />
      {canAdjust ? (
        <TransferCreateCard
          branches={workspace.branches}
          sourceBranch={workspace.branchId}
          onCreated={() =>
            void queryClient.invalidateQueries({ queryKey: ['inventory', 'transfers'] })
          }
        />
      ) : null}
      <Card title={t('inventory.transfers.inTransit')}>
        {transitQuery.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {transitQuery.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('inventory.transfers.noTransit')}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {transitQuery.data?.map((row) => (
            <Badge key={row.variant_id} variant="warning" className="text-sm font-medium">
              {row.sku}: {row.qty_in_transit}
            </Badge>
          ))}
        </div>
      </Card>
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {transfersQuery.isError ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {message(transfersQuery.error, t('inventory.transfers.loadError'))}
        </p>
      ) : null}
      {transfersQuery.data && transfers.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">{t('inventory.transfers.empty')}</p>
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
  const { t } = useTranslation();
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
    onError: (reason) => setError(message(reason, t('inventory.transfers.createError'))),
  });
  const addLine = () => {
    if (!variant || Number(qty) <= 0) return setError(t('inventory.transfers.pickAndQty'));
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
      return setError(t('inventory.transfers.twoBranches'));
    if (lines.length === 0) return setError(t('inventory.transfers.needLine'));
    mutation.mutate({
      from_branch: source,
      to_branch: destination,
      lines: lines.map(({ variant: id, qty: amount }) => ({ variant: id, qty: amount })),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };
  return (
    <Card title={t('inventory.transfers.create')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectBranch
            label={t('inventory.transfers.sourceBranch')}
            value={source}
            branches={branches}
            onChange={setFromBranch}
          />
          <SelectBranch
            label={t('inventory.transfers.destinationBranch')}
            value={destination}
            branches={branches.filter((branch) => branch.id !== source)}
            onChange={setToBranch}
          />
        </div>
        {variant ? (
          <p className="rounded-md border border-primary/40 bg-primary/5 p-2 text-sm">
            {variant.itemName} — {variant.sku}{' '}
            <button
              type="button"
              className="ml-2 text-primary underline"
              onClick={() => setVariant(null)}
            >
              {t('catalog.picker.change')}
            </button>
          </p>
        ) : (
          <VariantPicker onPick={setVariant} />
        )}
        <div className="flex gap-2">
          <Input
            aria-label={t('inventory.transfers.quantity')}
            type="number"
            min="0.001"
            step="0.001"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            className="w-40"
          />
          <Button variant="secondary" onClick={addLine}>
            {t('inventory.transfers.addLine')}
          </Button>
        </div>
        {lines.map((line) => (
          <div
            key={line.variant}
            className="flex justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
          >
            <span>{line.label}</span>
            <span className="tabular-nums">{line.qty}</span>
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="transfer-note">{t('inventory.transfers.note')}</Label>
          <textarea
            id="transfer-note"
            aria-label={t('inventory.transfers.noteAria')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('inventory.transfers.note')}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={mutation.isPending}>
          {t('inventory.transfers.create')}
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
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClasses}
      >
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.code} — {branch.name}
          </option>
        ))}
      </select>
    </div>
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
  const { t } = useTranslation();
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const receivedLines = transfer.items.flatMap((item) =>
    Number(receipts[item.variant]) > 0
      ? [{ variant: item.variant, qty: receipts[item.variant] }]
      : [],
  );
  const receiving = transfer.status === 'SENT' && canAdjust;
  const columns: readonly ReportColumn[] = [
    { header: t('inventory.transfers.columns.item') },
    { header: t('inventory.transfers.columns.sku') },
    { header: t('inventory.transfers.columns.sent'), className: 'text-right' },
    { header: t('inventory.transfers.columns.received'), className: 'text-right' },
    ...(receiving ? [{ header: t('inventory.transfers.columns.receiveNow') }] : []),
  ];
  const receiptInput = (variant: string, sku: string) => (
    <input
      aria-label={t('inventory.transfers.receiveSku', { sku })}
      type="number"
      min="0"
      step="0.001"
      value={receipts[variant] ?? ''}
      onChange={(event) =>
        setReceipts((current) => ({
          ...current,
          [variant]: event.target.value,
        }))
      }
      className={cn(cellInputClasses, 'w-28')}
    />
  );
  return (
    <Card title={`${transfer.status} · ${transfer.created_by_name ?? t('inventory.system')}`}>
      <h2 className="text-lg font-semibold">
        {transfer.from_branch_code} → {transfer.to_branch_code}
      </h2>
      {transfer.note ? <p className="text-sm text-muted-foreground">{transfer.note}</p> : null}
      <div className="mt-3">
        <ReportTable
          columns={columns}
          rows={transfer.items}
          rowKey={(item) => item.id}
          empty={t('inventory.transfers.emptyLines')}
          renderCells={(item) => (
            <>
              <TableCell className="font-medium">{item.item_name}</TableCell>
              <TableCell className="text-muted-foreground">{item.variant_sku}</TableCell>
              <TableCell className="text-right tabular-nums">{item.qty_sent}</TableCell>
              <TableCell className="text-right tabular-nums">{item.qty_received ?? '0'}</TableCell>
              {receiving ? (
                <TableCell>{receiptInput(item.variant, item.variant_sku)}</TableCell>
              ) : null}
            </>
          )}
          renderCard={(item) => (
            <div className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{item.item_name}</p>
                <p className="text-muted-foreground">{item.variant_sku}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                <p className="tabular-nums">
                  {t('inventory.transfers.sentReceived', {
                    sent: item.qty_sent,
                    received: item.qty_received ?? '0',
                  })}
                </p>
                {receiving ? receiptInput(item.variant, item.variant_sku) : null}
              </div>
            </div>
          )}
        />
      </div>
      {canAdjust ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {transfer.status === 'DRAFT' ? (
            <>
              <Button disabled={pending} onClick={() => onAction('send')}>
                {t('inventory.transfers.send')}
              </Button>
              <Button variant="danger" disabled={pending} onClick={() => onAction('cancel')}>
                {t('inventory.transfers.cancelDraft')}
              </Button>
            </>
          ) : null}
          {transfer.status === 'SENT' ? (
            <>
              <Button
                disabled={pending || receivedLines.length === 0}
                onClick={() => onAction('receive', receivedLines)}
              >
                {t('inventory.transfers.receiveEntered')}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => onAction('complete')}>
                {t('inventory.transfers.complete')}
              </Button>
              <span className="text-xs text-warning">
                {t('inventory.transfers.shortageWarning')}
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
