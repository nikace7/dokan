import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TableCell } from '@/components/ui/table';
import type { StockTransfer, TransferLinePayload } from '@/features/inventory/api';
import { cellInputClasses } from '@/features/inventory/ui';
import { ReportTable } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { cn } from '@/lib/utils';

interface TransferCardProps {
  transfer: StockTransfer;
  canAdjust: boolean;
  pending: boolean;
  onAction: (action: string, lines?: TransferLinePayload[]) => void;
}

export function TransferCard({ transfer, canAdjust, pending, onAction }: TransferCardProps) {
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
        setReceipts((current) => ({ ...current, [variant]: event.target.value }))
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
