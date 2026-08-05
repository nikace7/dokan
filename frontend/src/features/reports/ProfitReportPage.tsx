import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { currentBsMonthRange, fetchProfit } from '@/features/reports/api';
import type { BsRange } from '@/features/reports/api';
import { BsRangeControls } from '@/features/reports/BsRangeControls';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

/**
 * Profit report — revenue / COGS / gross profit by BS month. The backend
 * requires report.profit AND cost visibility; a 403 means "owner only" and
 * gets a friendly panel, not an error dump (invariant 10).
 */
export function ProfitReportPage() {
  const [range, setRange] = useState<BsRange>(currentBsMonthRange);

  const query = useQuery({
    queryKey: ['reports', 'profit', range],
    queryFn: () => fetchProfit(range),
    retry: false,
  });

  const forbidden = query.error instanceof ApiError && query.error.status === 403;

  return (
    <main className="mx-auto max-w-6xl p-4">
      <Card title="Profit report / नाफा प्रतिवेदन">
        <div className="mb-4">
          <BsRangeControls value={range} onApply={setRange} />
        </div>

        {forbidden ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center">
            <p className="text-base font-medium text-slate-700">Owner only</p>
            <p className="mt-1 text-sm text-slate-500">
              The profit report contains cost data and is only available to accounts with the profit
              and cost-visibility permissions. Ask the shop owner to run it.
            </p>
          </div>
        ) : null}

        {!forbidden && query.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {query.error instanceof Error ? query.error.message : 'Failed to load the report.'}
          </p>
        ) : null}
        {query.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}

        {query.data ? (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <StatCard label="Revenue" value={query.data.totals.revenue} />
              <StatCard label="Cost of goods" value={query.data.totals.cogs} />
              <StatCard label="Gross profit" value={query.data.totals.gross_profit} highlight />
            </div>

            {query.data.rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No sales in this range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="py-2 pr-2 font-medium">BS month</th>
                    <th className="py-2 pr-2 text-right font-medium">Sales</th>
                    <th className="py-2 pr-2 text-right font-medium">Returns</th>
                    <th className="py-2 pr-2 text-right font-medium">Revenue</th>
                    <th className="py-2 pr-2 text-right font-medium">COGS</th>
                    <th className="py-2 text-right font-medium">Gross profit</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => (
                    <tr key={row.bs_month} className="border-b border-slate-100">
                      <td className="py-2 pr-2 font-medium">{row.bs_month}</td>
                      <td className="py-2 pr-2 text-right">
                        {formatNpr(row.sales_total, { symbol: '' })}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {formatNpr(row.returns_total, { symbol: '' })}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {formatNpr(row.revenue, { symbol: '' })}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {formatNpr(row.cogs, { symbol: '' })}
                      </td>
                      <td className="py-2 text-right font-medium">
                        {formatNpr(row.gross_profit, { symbol: '' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : null}
      </Card>
    </main>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={[
        'rounded-lg border px-4 py-3',
        highlight ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-slate-50',
      ].join(' ')}
    >
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{formatNpr(value)}</p>
    </div>
  );
}
