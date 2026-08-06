import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import { TableCell, TableRow } from '@/components/ui/table';
import { AGING_BUCKETS, fetchDues } from '@/features/reports/api';
import type { PayableRow, ReceivableRow } from '@/features/reports/api';
import { MoneyCell, ReportError, ReportTable, TableSkeleton } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { addPaisa, formatNpr, formatPaisa, toPaisa } from '@/lib/money';

/**
 * Dues report — customer udharo aging and supplier payables. Bucket
 * semantics (invoice age; unallocated money settles the oldest bucket
 * first) are computed server-side; this screen only renders.
 */
export function DuesReportPage() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ['reports', 'dues'], queryFn: fetchDues });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <Card title={t('reports.dues.customerTitle')}>
        {query.isFetching ? <TableSkeleton /> : null}
        {query.isError ? <ReportError error={query.error} /> : null}
        {query.data ? <ReceivablesTable rows={query.data.receivables} /> : null}
      </Card>

      <Card title={t('reports.dues.supplierTitle')}>
        {query.data ? <PayablesTable rows={query.data.payables} /> : null}
      </Card>
    </main>
  );
}

function ReceivablesTable({ rows }: { rows: ReceivableRow[] }) {
  const { t } = useTranslation();
  const columns: readonly ReportColumn[] = [
    { header: t('reports.columns.customer') },
    ...AGING_BUCKETS.map(
      (bucket): ReportColumn => ({
        header: t('reports.dues.days', { bucket }),
        className: 'text-right',
      }),
    ),
    { header: t('reports.total'), className: 'text-right' },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.customer_id}
      empty={t('reports.dues.emptyReceivables')}
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.customer_name}</TableCell>
          {AGING_BUCKETS.map((bucket) => (
            <MoneyCell key={bucket}>{formatNpr(row.buckets[bucket], { symbol: '' })}</MoneyCell>
          ))}
          <MoneyCell>
            <span className="font-semibold">{formatNpr(row.total_outstanding)}</span>
          </MoneyCell>
        </>
      )}
      renderCard={(row) => (
        <div className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-medium">{row.customer_name}</p>
            <p className="font-semibold tabular-nums">{formatNpr(row.total_outstanding)}</p>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {AGING_BUCKETS.filter((bucket) => toPaisa(row.buckets[bucket]) > 0).map((bucket) => (
              <span key={bucket}>
                {bucket}d: {formatNpr(row.buckets[bucket], { symbol: '' })}
              </span>
            ))}
          </div>
        </div>
      )}
      footer={
        <TableRow>
          <TableCell className="font-semibold">{t('reports.total')}</TableCell>
          {AGING_BUCKETS.map((bucket) => (
            <MoneyCell key={bucket}>
              {formatPaisa(addPaisa(...rows.map((r) => toPaisa(r.buckets[bucket]))))}
            </MoneyCell>
          ))}
          <MoneyCell>
            {formatPaisa(addPaisa(...rows.map((r) => toPaisa(r.total_outstanding))), {
              symbol: 'रू ',
            })}
          </MoneyCell>
        </TableRow>
      }
      mobileFooter={
        <div className="mt-2 flex justify-between rounded-md bg-muted/50 p-3 text-sm">
          <span className="text-muted-foreground">{t('reports.dues.totalOutstanding')}</span>
          <span className="font-semibold tabular-nums">
            {formatPaisa(addPaisa(...rows.map((r) => toPaisa(r.total_outstanding))), {
              symbol: 'रू ',
            })}
          </span>
        </div>
      }
    />
  );
}

function PayablesTable({ rows }: { rows: PayableRow[] }) {
  const { t } = useTranslation();
  const columns: readonly ReportColumn[] = [
    { header: t('reports.columns.supplier') },
    { header: t('reports.columns.payable'), className: 'text-right' },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.supplier_id}
      empty={t('reports.dues.emptyPayables')}
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.supplier_name}</TableCell>
          <MoneyCell>{formatNpr(row.payable)}</MoneyCell>
        </>
      )}
      renderCard={(row) => (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p className="font-medium">{row.supplier_name}</p>
          <p className="font-semibold tabular-nums">{formatNpr(row.payable)}</p>
        </div>
      )}
      footer={
        <TableRow>
          <TableCell className="font-semibold">{t('reports.total')}</TableCell>
          <MoneyCell>
            {formatPaisa(addPaisa(...rows.map((r) => toPaisa(r.payable))), { symbol: 'रू ' })}
          </MoneyCell>
        </TableRow>
      }
    />
  );
}
