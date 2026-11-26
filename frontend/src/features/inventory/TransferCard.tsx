import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { TableCell } from '@/components/ui/table';
import type { StockTransfer, TransferLinePayload } from '@/features/inventory/api';
import { cellInputClasses } from '@/features/inventory/ui';
import { ReportTable } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { formatQty } from '@/lib/quantity';
import { cn } from '@/lib/utils';

interface TransferCardProps {
  transfer: StockTransfer;
  canAdjust: boolean;
  pending: boolean;
  /** `done` runs once the server has taken the action. */
  onAction: (action: string, lines?: TransferLinePayload[], done?: () => void) => void;
}

export function TransferCard({ transfer, canAdjust, pending, onAction }: TransferCardProps) {
  const { t } = useTranslation();
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const receivedLines = transfer.items.flatMap((item) =>
    Number(receipts[item.variant]) > 0
      ? [{ variant: item.variant, qty: receipts[item.variant] }]
      : [],
  );
  const missing = transfer.items.reduce(
    (sum, item) => sum + Number(item.qty_sent) - Number(item.qty_received ?? 0),
    0,
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
        setReceipts((current) => ({ ...current, [variant]: event.target.value }))
      }
      className={cn(cellInputClasses, 'w-28')}
    />
  );
  return (
    <Card
      title={`${t(`inventory.transfers.status.${transfer.status}`)} · ${transfer.created_by_name ?? t('inventory.system')}`}
    >
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
              <TableCell className="text-right tabular-nums">{formatQty(item.qty_sent)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQty(item.qty_received ?? 0)}
              </TableCell>
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
                    sent: formatQty(item.qty_sent),
                    received: formatQty(item.qty_received ?? 0),
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
              <ConfirmDialog
                trigger={<Button disabled={pending}>{t('inventory.transfers.send')}</Button>}
                title={t('inventory.transfers.sendTitle')}
                body={t('inventory.transfers.sendBody', {
                  from: transfer.from_branch_code,
                  to: transfer.to_branch_code,
                })}
                confirmLabel={t('inventory.transfers.send')}
                onConfirm={() => onAction('send')}
              />
              <ConfirmDialog
                danger
                trigger={
                  <Button variant="danger" disabled={pending}>
                    {t('inventory.transfers.cancelDraft')}
                  </Button>
                }
                title={t('inventory.transfers.cancelTitle')}
                body={t('inventory.transfers.cancelBody')}
                confirmLabel={t('inventory.transfers.cancelDraft')}
                onConfirm={() => onAction('cancel')}
              />
            </>
          ) : null}
          {transfer.status === 'SENT' ? (
            <>
              <Button
                disabled={pending || receivedLines.length === 0}
                onClick={() => onAction('receive', receivedLines, () => setReceipts({}))}
              >
                {t('inventory.transfers.receiveEntered')}
              </Button>
              <ConfirmDialog
                danger={missing > 0}
                trigger={
                  <Button variant="secondary" disabled={pending}>
                    {t('inventory.transfers.complete')}
                  </Button>
                }
                title={t('inventory.transfers.completeTitle')}
                body={
                  missing > 0
                    ? t('inventory.transfers.completeShort', { qty: Number(missing.toFixed(3)) })
                    : t('inventory.transfers.completeBody')
                }
                confirmLabel={t('inventory.transfers.complete')}
                onConfirm={() => onAction('complete')}
              />
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
