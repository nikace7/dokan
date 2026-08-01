import { useQuery } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { AGING_BUCKETS, fetchDues } from '@/features/reports/api';
import { addPaisa, formatNpr, formatPaisa, toPaisa } from '@/lib/money';

/**
 * Dues report — customer udharo aging and supplier payables. Bucket
 * semantics (invoice age; unallocated money settles the oldest bucket
 * first) are computed server-side; this screen only renders.
 */
export function DuesReportPage() {
  const query = useQuery({ queryKey: ['reports', 'dues'], queryFn: fetchDues });

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Card title="Customer dues (udharo) / उधारो">
        {query.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {query.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {query.error instanceof Error ? query.error.message : 'Failed to load dues.'}
          </p>
        ) : null}
        {query.data && query.data.receivables.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No outstanding customer dues.</p>
        ) : null}
        {query.data && query.data.receivables.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2 font-medium">Customer</th>
                {AGING_BUCKETS.map((bucket) => (
                  <th key={bucket} className="py-2 pr-2 text-right font-medium">
                    {bucket} days
                  </th>
                ))}
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {query.data.receivables.map((row) => (
                <tr key={row.customer_id} className="border-b border-slate-100">
                  <td className="py-2 pr-2 font-medium">{row.customer_name}</td>
                  {AGING_BUCKETS.map((bucket) => (
                    <td key={bucket} className="py-2 pr-2 text-right">
                      {formatNpr(row.buckets[bucket], { symbol: '' })}
                    </td>
                  ))}
                  <td className="py-2 text-right font-semibold">
                    {formatNpr(row.total_outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-2 pr-2">Total</td>
                {AGING_BUCKETS.map((bucket) => (
                  <td key={bucket} className="py-2 pr-2 text-right">
                    {formatPaisa(
                      addPaisa(...query.data.receivables.map((r) => toPaisa(r.buckets[bucket]))),
                    )}
                  </td>
                ))}
                <td className="py-2 text-right">
                  {formatPaisa(
                    addPaisa(...query.data.receivables.map((r) => toPaisa(r.total_outstanding))),
                    { symbol: 'रू ' },
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        ) : null}
      </Card>

      <Card title="Supplier payables">
        {query.data && query.data.payables.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No outstanding payables.</p>
        ) : null}
        {query.data && query.data.payables.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2 font-medium">Supplier</th>
                <th className="py-2 text-right font-medium">Payable</th>
              </tr>
            </thead>
            <tbody>
              {query.data.payables.map((row) => (
                <tr key={row.supplier_id} className="border-b border-slate-100">
                  <td className="py-2 pr-2 font-medium">{row.supplier_name}</td>
                  <td className="py-2 text-right">{formatNpr(row.payable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </main>
  );
}
