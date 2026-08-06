import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/Card';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { currentBsMonthRange } from '@/features/reports/api';
import { fetchPurchaseVatRegister, fetchSalesVatRegister } from '@/features/reports/api';
import type { BsRange, PurchaseVatRow, SalesVatRow, VatRegister } from '@/features/reports/api';
import { BsRangeControls } from '@/features/reports/BsRangeControls';
import { MoneyCell, ReportError, ReportTable, TableSkeleton } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { formatNpr } from '@/lib/money';

type RegisterKind = 'sales' | 'purchase';

function money(amount: string): string {
  return formatNpr(amount, { symbol: '' });
}

/** IRD VAT registers — sales and purchase, by BS date range. */
export function VatRegisterPage() {
  const [kind, setKind] = useState<RegisterKind>('sales');
  const [range, setRange] = useState<BsRange>(currentBsMonthRange);

  const salesQuery = useQuery({
    queryKey: ['reports', 'vat-sales', range],
    queryFn: () => fetchSalesVatRegister(range),
    enabled: kind === 'sales',
  });
  const purchaseQuery = useQuery({
    queryKey: ['reports', 'vat-purchase', range],
    queryFn: () => fetchPurchaseVatRegister(range),
    enabled: kind === 'purchase',
  });

  const activeQuery = kind === 'sales' ? salesQuery : purchaseQuery;

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <Card title="VAT register / भ्याट दर्ता">
        <Tabs value={kind} onValueChange={(value) => setKind(value as RegisterKind)}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TabsList aria-label="Register">
              <TabsTrigger value="sales">Sales (बिजक)</TabsTrigger>
              <TabsTrigger value="purchase">Purchase (खरिद)</TabsTrigger>
            </TabsList>
            <BsRangeControls value={range} onApply={setRange} />
          </div>

          {activeQuery.isFetching ? <TableSkeleton /> : null}
          {activeQuery.isError ? <ReportError error={activeQuery.error} /> : null}

          <TabsContent value="sales">
            {salesQuery.data && !salesQuery.isFetching ? (
              <SalesRegister data={salesQuery.data} />
            ) : null}
          </TabsContent>
          <TabsContent value="purchase">
            {purchaseQuery.data && !purchaseQuery.isFetching ? (
              <PurchaseRegister data={purchaseQuery.data} />
            ) : null}
          </TabsContent>
        </Tabs>
      </Card>
    </main>
  );
}

function TotalsFooter({ totals, colSpan }: { totals: VatRegister<never>['totals']; colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="font-semibold">
        Total
      </TableCell>
      <MoneyCell>{money(totals.taxable_amount)}</MoneyCell>
      <MoneyCell>{money(totals.vat_amount)}</MoneyCell>
      <MoneyCell>{money(totals.total)}</MoneyCell>
    </TableRow>
  );
}

function TotalsCard({ totals }: { totals: VatRegister<never>['totals'] }) {
  return (
    <dl className="mt-2 space-y-1 rounded-md bg-muted/50 p-3 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Taxable</dt>
        <dd className="tabular-nums">{money(totals.taxable_amount)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">VAT</dt>
        <dd className="tabular-nums">{money(totals.vat_amount)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Total</dt>
        <dd className="font-semibold tabular-nums">{money(totals.total)}</dd>
      </div>
    </dl>
  );
}

const SALES_COLUMNS: readonly ReportColumn[] = [
  { header: 'Invoice' },
  { header: 'Date (BS)' },
  { header: 'Customer' },
  { header: 'PAN' },
  { header: 'Taxable', className: 'text-right' },
  { header: 'VAT', className: 'text-right' },
  { header: 'Total', className: 'text-right' },
];

function SalesRegister({ data }: { data: VatRegister<SalesVatRow> }) {
  return (
    <ReportTable
      columns={SALES_COLUMNS}
      rows={data.rows}
      rowKey={(row) => `${row.doc_type}:${row.invoice_no}`}
      empty="No VAT bills in this range."
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">
            {row.invoice_no}
            {row.doc_type === 'RETURN' ? (
              <Badge variant="secondary" className="ml-1">
                CN
              </Badge>
            ) : null}
          </TableCell>
          <TableCell>{row.business_date_bs}</TableCell>
          <TableCell className="text-muted-foreground">{row.customer_name ?? 'Walk-in'}</TableCell>
          <TableCell className="text-muted-foreground">{row.customer_pan ?? '—'}</TableCell>
          <MoneyCell>{money(row.taxable_amount)}</MoneyCell>
          <MoneyCell>{money(row.vat_amount)}</MoneyCell>
          <MoneyCell>{money(row.total)}</MoneyCell>
        </>
      )}
      renderCard={(row) => (
        <div className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium">
              {row.invoice_no}
              {row.doc_type === 'RETURN' ? (
                <Badge variant="secondary" className="ml-1">
                  CN
                </Badge>
              ) : null}
            </p>
            <p className="truncate text-muted-foreground">
              {row.business_date_bs} · {row.customer_name ?? 'Walk-in'} · VAT{' '}
              {money(row.vat_amount)}
            </p>
          </div>
          <p className="text-right font-semibold tabular-nums">{money(row.total)}</p>
        </div>
      )}
      footer={<TotalsFooter totals={data.totals} colSpan={4} />}
      mobileFooter={<TotalsCard totals={data.totals} />}
    />
  );
}

const PURCHASE_COLUMNS: readonly ReportColumn[] = [
  { header: 'Invoice' },
  { header: 'Date (BS)' },
  { header: 'Supplier' },
  { header: 'PAN' },
  { header: 'Taxable', className: 'text-right' },
  { header: 'VAT', className: 'text-right' },
  { header: 'Total', className: 'text-right' },
];

function PurchaseRegister({ data }: { data: VatRegister<PurchaseVatRow> }) {
  return (
    <ReportTable
      columns={PURCHASE_COLUMNS}
      rows={data.rows}
      rowKey={(row) => row.invoice_no}
      empty="No purchase VAT bills in this range."
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.invoice_no}</TableCell>
          <TableCell>{row.bill_date_bs}</TableCell>
          <TableCell className="text-muted-foreground">{row.supplier_name}</TableCell>
          <TableCell className="text-muted-foreground">{row.supplier_pan ?? '—'}</TableCell>
          <MoneyCell>{money(row.taxable_amount)}</MoneyCell>
          <MoneyCell>{money(row.vat_amount)}</MoneyCell>
          <MoneyCell>{money(row.total)}</MoneyCell>
        </>
      )}
      renderCard={(row) => (
        <div className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{row.invoice_no}</p>
            <p className="truncate text-muted-foreground">
              {row.bill_date_bs} · {row.supplier_name} · VAT {money(row.vat_amount)}
            </p>
          </div>
          <p className="text-right font-semibold tabular-nums">{money(row.total)}</p>
        </div>
      )}
      footer={<TotalsFooter totals={data.totals} colSpan={4} />}
      mobileFooter={<TotalsCard totals={data.totals} />}
    />
  );
}
