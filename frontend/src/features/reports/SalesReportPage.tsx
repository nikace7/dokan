import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { currentBsMonthRange, currentFiscalYearBs } from '@/features/reports/api';
import { fetchDailySales, fetchItemSales, fetchMonthlySales } from '@/features/reports/api';
import type { BsRange, DailySalesRow, ItemSalesRow, MonthlySalesRow } from '@/features/reports/api';
import { BsRangeControls } from '@/features/reports/BsRangeControls';
import { addPaisa, formatNpr, formatPaisa, toPaisa } from '@/lib/money';
import type { Paisa } from '@/lib/money';

type Tab = 'daily' | 'monthly' | 'items';

function sumMoney(amounts: readonly string[]): Paisa {
  return addPaisa(...amounts.map(toPaisa));
}

function money(amount: string): string {
  return formatNpr(amount, { symbol: '' });
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
    <main className="mx-auto max-w-6xl p-4">
      <Card title="Sales report / बिक्री प्रतिवेदन">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Sales view" className="flex gap-1">
            {(
              [
                ['daily', 'Daily'],
                ['monthly', 'Monthly'],
                ['items', 'Top items'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={[
                  'rounded-md px-3 py-2 text-sm font-medium',
                  tab === id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'monthly' ? (
            <div className="flex items-center gap-2">
              <label htmlFor="fy" className="text-sm font-medium text-slate-700">
                Fiscal year (BS)
              </label>
              <input
                id="fy"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(e.target.value)}
                placeholder="2083-84"
                className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          ) : (
            <BsRangeControls value={range} onApply={setRange} />
          )}
        </div>

        {activeQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {activeQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {activeQuery.error instanceof Error
              ? activeQuery.error.message
              : 'Failed to load the report.'}
          </p>
        ) : null}

        {tab === 'daily' && dailyQuery.data ? <DailyTable rows={dailyQuery.data} /> : null}
        {tab === 'monthly' && monthlyQuery.data ? <MonthlyTable rows={monthlyQuery.data} /> : null}
        {tab === 'items' && itemsQuery.data ? <ItemsTable rows={itemsQuery.data.data} /> : null}
      </Card>
    </main>
  );
}

function DailyTable({ rows }: { rows: DailySalesRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No sales in this range.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-2 pr-2 font-medium">Date (BS)</th>
          <th className="py-2 pr-2 text-right font-medium">Bills</th>
          <th className="py-2 pr-2 text-right font-medium">Subtotal</th>
          <th className="py-2 pr-2 text-right font-medium">Discount</th>
          <th className="py-2 pr-2 text-right font-medium">VAT</th>
          <th className="py-2 pr-2 text-right font-medium">Total</th>
          <th className="py-2 pr-2 text-right font-medium">Paid</th>
          <th className="py-2 pr-2 text-right font-medium">Due</th>
          <th className="py-2 pr-2 text-right font-medium">Returns</th>
          <th className="py-2 text-right font-medium">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.business_date_bs} className="border-b border-slate-100">
            <td className="py-2 pr-2 font-medium">{row.business_date_bs}</td>
            <td className="py-2 pr-2 text-right">{row.bill_count}</td>
            <td className="py-2 pr-2 text-right">{money(row.subtotal)}</td>
            <td className="py-2 pr-2 text-right">{money(row.discount)}</td>
            <td className="py-2 pr-2 text-right">{money(row.vat)}</td>
            <td className="py-2 pr-2 text-right">{money(row.total)}</td>
            <td className="py-2 pr-2 text-right">{money(row.paid)}</td>
            <td className="py-2 pr-2 text-right">{money(row.due)}</td>
            <td className="py-2 pr-2 text-right">
              {row.returns_count > 0 ? money(row.returns_total) : '—'}
            </td>
            <td className="py-2 text-right font-medium">{money(row.net_total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-300 font-semibold">
          <td className="py-2 pr-2">Total</td>
          <td className="py-2 pr-2 text-right">{rows.reduce((n, r) => n + r.bill_count, 0)}</td>
          <td className="py-2 pr-2 text-right">
            {formatPaisa(sumMoney(rows.map((r) => r.subtotal)))}
          </td>
          <td className="py-2 pr-2 text-right">
            {formatPaisa(sumMoney(rows.map((r) => r.discount)))}
          </td>
          <td className="py-2 pr-2 text-right">{formatPaisa(sumMoney(rows.map((r) => r.vat)))}</td>
          <td className="py-2 pr-2 text-right">
            {formatPaisa(sumMoney(rows.map((r) => r.total)))}
          </td>
          <td className="py-2 pr-2 text-right">{formatPaisa(sumMoney(rows.map((r) => r.paid)))}</td>
          <td className="py-2 pr-2 text-right">{formatPaisa(sumMoney(rows.map((r) => r.due)))}</td>
          <td className="py-2 pr-2 text-right">
            {formatPaisa(sumMoney(rows.map((r) => r.returns_total)))}
          </td>
          <td className="py-2 text-right">{formatPaisa(sumMoney(rows.map((r) => r.net_total)))}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function MonthlyTable({ rows }: { rows: MonthlySalesRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No sales in this fiscal year.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-2 pr-2 font-medium">BS month</th>
          <th className="py-2 pr-2 text-right font-medium">Bills</th>
          <th className="py-2 pr-2 text-right font-medium">Total</th>
          <th className="py-2 pr-2 text-right font-medium">Discount</th>
          <th className="py-2 pr-2 text-right font-medium">VAT</th>
          <th className="py-2 pr-2 text-right font-medium">Returns</th>
          <th className="py-2 text-right font-medium">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.bs_month} className="border-b border-slate-100">
            <td className="py-2 pr-2 font-medium">{row.bs_month}</td>
            <td className="py-2 pr-2 text-right">{row.bill_count}</td>
            <td className="py-2 pr-2 text-right">{money(row.total)}</td>
            <td className="py-2 pr-2 text-right">{money(row.discount)}</td>
            <td className="py-2 pr-2 text-right">{money(row.vat)}</td>
            <td className="py-2 pr-2 text-right">{money(row.returns_total)}</td>
            <td className="py-2 text-right font-medium">{money(row.net_total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ItemsTable({ rows }: { rows: ItemSalesRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No items sold in this range.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-2 pr-2 font-medium">SKU</th>
          <th className="py-2 pr-2 font-medium">Item</th>
          <th className="py-2 pr-2 font-medium">Size / Colour</th>
          <th className="py-2 pr-2 text-right font-medium">Qty sold</th>
          <th className="py-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.variant_id} className="border-b border-slate-100">
            <td className="py-2 pr-2 font-medium">{row.sku}</td>
            <td className="py-2 pr-2">{row.item_name}</td>
            <td className="py-2 pr-2 text-slate-600">
              {row.size} / {row.color}
            </td>
            <td className="py-2 pr-2 text-right">{row.qty}</td>
            <td className="py-2 text-right">{money(row.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
