import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { listPriceChanges, listPrices } from '@/features/pricing/api';
import { formatNpr } from '@/lib/money';

function target(row: {
  scope?: string;
  target_type?: string;
  variant?: string | null;
  item?: string | null;
  category?: string | null;
  target_id?: string;
}) {
  return `${row.scope ?? row.target_type} · ${row.variant ?? row.item ?? row.category ?? row.target_id ?? '—'}`;
}

export function PriceTables() {
  const [pricePage, setPricePage] = useState(1);
  const [changePage, setChangePage] = useState(1);
  const prices = useQuery({
    queryKey: ['pricing', 'prices', pricePage],
    queryFn: () => listPrices({ page: pricePage }),
  });
  const changes = useQuery({
    queryKey: ['pricing', 'changes', changePage],
    queryFn: () => listPriceChanges(changePage),
  });

  return (
    <>
      <Card title="Effective price records">
        {prices.isPending ? <p className="text-sm text-slate-500">Loading prices…</p> : null}
        {prices.isError ? (
          <p role="alert" className="text-sm text-red-700">
            {prices.error instanceof Error ? prices.error.message : 'Could not load prices.'}
          </p>
        ) : null}
        {prices.data?.data.length === 0 ? (
          <p className="text-sm text-slate-500">No explicit prices yet; POS falls back to MRP.</p>
        ) : null}
        {prices.data?.data.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-2">Target</th>
                <th className="py-2">Rate</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2">Effective dates</th>
              </tr>
            </thead>
            <tbody>
              {prices.data.data.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="py-2 font-mono text-xs">{target(row)}</td>
                  <td className="py-2">{row.rate_type_code}</td>
                  <td className="py-2 text-right font-medium">{formatNpr(row.price)}</td>
                  <td className="py-2">
                    {row.effective_from} → {row.effective_to ?? 'open'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <Pager meta={prices.data?.meta ?? undefined} page={pricePage} setPage={setPricePage} />
      </Card>

      <Card title="Immutable price change history">
        {changes.isPending ? <p className="text-sm text-slate-500">Loading history…</p> : null}
        {changes.isError ? (
          <p role="alert" className="text-sm text-red-700">
            {changes.error instanceof Error ? changes.error.message : 'Could not load history.'}
          </p>
        ) : null}
        {changes.data?.data.length === 0 ? (
          <p className="text-sm text-slate-500">No price changes recorded.</p>
        ) : null}
        {changes.data?.data.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-2">Target</th>
                <th className="py-2">Rate</th>
                <th className="py-2">Change</th>
                <th className="py-2">Actor / reason</th>
                <th className="py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {changes.data.data.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="py-2 font-mono text-xs">{target(row)}</td>
                  <td className="py-2">{row.rate_type_code ?? '—'}</td>
                  <td className="py-2">
                    {row.old_price ? formatNpr(row.old_price) : 'Unset'} →{' '}
                    {row.new_price ? formatNpr(row.new_price) : 'Unset'}
                  </td>
                  <td className="py-2">
                    <span className="block">{row.changed_by_name ?? 'System'}</span>
                    <span className="text-xs text-slate-500">{row.reason ?? 'No reason'}</span>
                  </td>
                  <td className="py-2">{new Date(row.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <Pager meta={changes.data?.meta ?? undefined} page={changePage} setPage={setChangePage} />
      </Card>
    </>
  );
}

function Pager({
  meta,
  page,
  setPage,
}: {
  meta?: { page: number; total_pages: number };
  page: number;
  setPage: (page: number) => void;
}) {
  if (!meta || meta.total_pages <= 1) return null;
  return (
    <div className="mt-3 flex justify-end gap-2">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        Previous
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= meta.total_pages}
        onClick={() => setPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
