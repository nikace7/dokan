import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { currentBsMonthRange, currentFiscalYearBs } from '@/features/reports/api';
import { fetchDailySales, fetchItemSales, fetchMonthlySales } from '@/features/reports/api';
import type { BsRange, DailySalesRow, ItemSalesRow, MonthlySalesRow } from '@/features/reports/api';
import { BsRangeControls } from '@/features/reports/BsRangeControls';
import { ItemSalesChart } from '@/features/reports/ItemSalesChart';
import { MoneyCell, ReportError, ReportTable, TableSkeleton } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { addPaisa, formatNpr, formatPaisa, toPaisa } from '@/lib/money';
import type { Paisa } from '@/lib/money';

type Tab = 'daily' | 'monthly' | 'items';

function sumMoney(amounts: readonly string[]): Paisa {
  return addPaisa(...amounts.map(toPaisa));
}

function money(amount: string): string {
  return formatNpr(amount, { symbol: '' });
}

function qtyTotal(rows: readonly { qty: string }[]): string {
  const total = rows.reduce((sum, row) => sum + Number(row.qty), 0);
  return Number.isInteger(total) ? String(total) : total.toFixed(2);
}

/** Sales report — daily by BS date, monthly by fiscal year, top items. */
export function SalesReportPage() {
  const [tab, setTab] = useState<Tab>('daily');
  const [range, setRange] = useState<BsRange>(currentBsMonthRange);
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYearBs);

  const dailyQuery = useQuery({
    queryKey: ['reports', 'daily-sales', range],
    queryFn: () => fetchDailySales(range),
    enabled: tab === 'daily',
  });
  const monthlyQuery = useQuery({
    queryKey: ['reports', 'monthly-sales', fiscalYear],
    queryFn: () => fetchMonthlySales(fiscalYear),
    enabled: tab === 'monthly',
  });
  const itemsQuery = useQuery({
    queryKey: ['reports', 'item-sales', range],
    queryFn: () => fetchItemSales(range),
    enabled: tab === 'items',
  });

  const activeQuery = tab === 'daily' ? dailyQuery : tab === 'monthly' ? monthlyQuery : itemsQuery;

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <Card title="Sales report / बिक्री प्रतिवेदन">
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TabsList aria-label="Sales view">
              <TabsTrigger value="daily">Daily</TabsTrigger>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="items">Top items</TabsTrigger>
            </TabsList>
            {tab === 'monthly' ? (
              <Input
                id="fy"
                label="Fiscal year (BS)"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(e.target.value)}
                placeholder="2083-84"
                className="w-28"
              />
            ) : (
              <BsRangeControls value={range} onApply={setRange} />
            )}
          </div>

          {activeQuery.isFetching ? <TableSkeleton /> : null}
          {activeQuery.isError ? <ReportError error={activeQuery.error} /> : null}

          <TabsContent value="daily">
            {dailyQuery.data && !dailyQuery.isFetching ? (
              <DailyTable rows={dailyQuery.data} />
            ) : null}
          </TabsContent>
          <TabsContent value="monthly">
            {monthlyQuery.data && !monthlyQuery.isFetching ? (
              <MonthlyTable rows={monthlyQuery.data} />
            ) : null}
          </TabsContent>
          <TabsContent value="items">
            {itemsQuery.data && !itemsQuery.isFetching ? (
              <>
                <ItemSalesChart rows={itemsQuery.data.data} />
                <ItemsTable rows={itemsQuery.data.data} />
              </>
            ) : null}
          </TabsContent>
        </Tabs>
      </Card>
    </main>
  );
}

const DAILY_COLUMNS: readonly ReportColumn[] = [
  { header: 'Date (BS)' },
  { header: 'Bills', className: 'text-right' },
  { header: 'Subtotal', className: 'text-right' },
  { header: 'Discount', className: 'text-right' },
  { header: 'VAT', className: 'text-right' },
  { header: 'Total', className: 'text-right' },
  { header: 'Paid', className: 'text-right' },
  { header: 'Due', className: 'text-right' },
  { header: 'Returns', className: 'text-right' },
  { header: 'Net', className: 'text-right' },
];

function DailyTable({ rows }: { rows: DailySalesRow[] }) {
  return (
    <ReportTable
      columns={DAILY_COLUMNS}
      rows={rows}
      rowKey={(row) => row.business_date_bs}
      empty="No sales in this range."
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.business_date_bs}</TableCell>
          <TableCell className="text-right tabular-nums">{row.bill_count}</TableCell>
          <MoneyCell>{money(row.subtotal)}</MoneyCell>
          <MoneyCell>{money(row.discount)}</MoneyCell>
          <MoneyCell>{money(row.vat)}</MoneyCell>
          <MoneyCell>{money(row.total)}</MoneyCell>
          <MoneyCell>{money(row.paid)}</MoneyCell>
          <MoneyCell>{money(row.due)}</MoneyCell>
          <MoneyCell>{row.returns_count > 0 ? money(row.returns_total) : '—'}</MoneyCell>
          <MoneyCell>
            <span className="font-medium">{money(row.net_total)}</span>
          </MoneyCell>
        </>
      )}
      renderCard={(row) => (
        <div className="flex items-start justify-between gap-3 text-sm">
          <div>
            <p className="font-medium">{row.business_date_bs}</p>
            <p className="text-muted-foreground">
              {row.bill_count} bills · paid {money(row.paid)}
              {toPaisa(row.due) > 0 ? ` · due ${money(row.due)}` : ''}
              {row.returns_count > 0 ? ` · returns ${money(row.returns_total)}` : ''}
            </p>
          </div>
          <p className="text-right font-semibold tabular-nums">{money(row.net_total)}</p>
        </div>
      )}
      footer={
        <TableRow>
          <TableCell className="font-semibold">Total</TableCell>
          <TableCell className="text-right tabular-nums">
            {rows.reduce((n, r) => n + r.bill_count, 0)}
          </TableCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.subtotal)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.discount)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.vat)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.total)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.paid)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.due)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.returns_total)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.net_total)))}</MoneyCell>
        </TableRow>
      }
      mobileFooter={
        <dl className="mt-2 space-y-1 rounded-md bg-muted/50 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Bills</dt>
            <dd className="font-medium tabular-nums">
              {rows.reduce((n, r) => n + r.bill_count, 0)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-medium tabular-nums">
              {formatPaisa(sumMoney(rows.map((r) => r.total)))}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Net</dt>
            <dd className="font-semibold tabular-nums">
              {formatPaisa(sumMoney(rows.map((r) => r.net_total)))}
            </dd>
          </div>
        </dl>
      }
    />
  );
}

const MONTHLY_COLUMNS: readonly ReportColumn[] = [
  { header: 'BS month' },
  { header: 'Bills', className: 'text-right' },
  { header: 'Total', className: 'text-right' },
  { header: 'Discount', className: 'text-right' },
  { header: 'VAT', className: 'text-right' },
  { header: 'Returns', className: 'text-right' },
  { header: 'Net', className: 'text-right' },
];

function MonthlyTable({ rows }: { rows: MonthlySalesRow[] }) {
  return (
    <ReportTable
      columns={MONTHLY_COLUMNS}
      rows={rows}
      rowKey={(row) => row.bs_month}
      empty="No sales in this fiscal year."
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.bs_month}</TableCell>
          <TableCell className="text-right tabular-nums">{row.bill_count}</TableCell>
          <MoneyCell>{money(row.total)}</MoneyCell>
          <MoneyCell>{money(row.discount)}</MoneyCell>
          <MoneyCell>{money(row.vat)}</MoneyCell>
          <MoneyCell>{money(row.returns_total)}</MoneyCell>
          <MoneyCell>
            <span className="font-medium">{money(row.net_total)}</span>
          </MoneyCell>
        </>
      )}
      renderCard={(row) => (
        <div className="flex items-start justify-between gap-3 text-sm">
          <div>
            <p className="font-medium">{row.bs_month}</p>
            <p className="text-muted-foreground">
              {row.bill_count} bills
              {toPaisa(row.returns_total) > 0 ? ` · returns ${money(row.returns_total)}` : ''}
            </p>
          </div>
          <p className="text-right font-semibold tabular-nums">{money(row.net_total)}</p>
        </div>
      )}
      footer={
        <TableRow>
          <TableCell className="font-semibold">Total</TableCell>
          <TableCell className="text-right tabular-nums">
            {rows.reduce((n, r) => n + r.bill_count, 0)}
          </TableCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.total)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.discount)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.vat)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.returns_total)))}</MoneyCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.net_total)))}</MoneyCell>
        </TableRow>
      }
    />
  );
}

const ITEM_COLUMNS: readonly ReportColumn[] = [
  { header: 'SKU' },
  { header: 'Item' },
  { header: 'Size / Colour' },
  { header: 'Qty sold', className: 'text-right' },
  { header: 'Amount', className: 'text-right' },
];

function ItemsTable({ rows }: { rows: ItemSalesRow[] }) {
  return (
    <ReportTable
      columns={ITEM_COLUMNS}
      rows={rows}
      rowKey={(row) => row.variant_id}
      empty="No items sold in this range."
      renderCells={(row) => (
        <>
          <TableCell className="font-medium">{row.sku}</TableCell>
          <TableCell>{row.item_name}</TableCell>
          <TableCell className="text-muted-foreground">
            {row.size} / {row.color}
          </TableCell>
          <TableCell className="text-right tabular-nums">{row.qty}</TableCell>
          <MoneyCell>{money(row.amount)}</MoneyCell>
        </>
      )}
      renderCard={(row) => (
        <div className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{row.item_name}</p>
            <p className="truncate text-muted-foreground">
              {row.sku} · {row.size} / {row.color} · qty {row.qty}
            </p>
          </div>
          <p className="text-right font-semibold tabular-nums">{money(row.amount)}</p>
        </div>
      )}
      footer={
        <TableRow>
          <TableCell colSpan={3} className="font-semibold">
            Total
          </TableCell>
          <TableCell className="text-right tabular-nums">{qtyTotal(rows)}</TableCell>
          <MoneyCell>{formatPaisa(sumMoney(rows.map((r) => r.amount)))}</MoneyCell>
        </TableRow>
      }
    />
  );
}
