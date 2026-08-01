import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Card } from '@/components/ui/Card';
import { currentBsMonthRange } from '@/features/reports/api';
import { fetchPurchaseVatRegister, fetchSalesVatRegister } from '@/features/reports/api';
import type { BsRange, PurchaseVatRow, SalesVatRow, VatRegister } from '@/features/reports/api';
import { BsRangeControls } from '@/features/reports/BsRangeControls';
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
    <main className="mx-auto max-w-6xl p-4">
      <Card title="VAT register / भ्याट दर्ता">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Register" className="flex gap-1">
            {(
              [
                ['sales', 'Sales (बिजक)'],
                ['purchase', 'Purchase (खरिद)'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={kind === id}
                onClick={() => setKind(id)}
                className={[
                  'rounded-md px-3 py-2 text-sm font-medium',
                  kind === id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          <BsRangeControls value={range} onApply={setRange} />
        </div>

        {activeQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {activeQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {activeQuery.error instanceof Error
              ? activeQuery.error.message
              : 'Failed to load the register.'}
          </p>
        ) : null}

        {kind === 'sales' && salesQuery.data ? <SalesRegister data={salesQuery.data} /> : null}
        {kind === 'purchase' && purchaseQuery.data ? (
          <PurchaseRegister data={purchaseQuery.data} />
        ) : null}
      </Card>
    </main>
  );
}

function TotalsRow({ totals, colSpan }: { totals: VatRegister<never>['totals']; colSpan: number }) {
  return (
    <tr className="border-t-2 border-slate-300 font-semibold">
      <td colSpan={colSpan} className="py-2 pr-2">
        Total
      </td>
      <td className="py-2 pr-2 text-right">{money(totals.taxable_amount)}</td>
      <td className="py-2 pr-2 text-right">{money(totals.vat_amount)}</td>
      <td className="py-2 text-right">{money(totals.total)}</td>
    </tr>
  );
}

function SalesRegister({ data }: { data: VatRegister<SalesVatRow> }) {
  if (data.rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No VAT bills in this range.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-2 pr-2 font-medium">Invoice</th>
          <th className="py-2 pr-2 font-medium">Date (BS)</th>
          <th className="py-2 pr-2 font-medium">Customer</th>
          <th className="py-2 pr-2 font-medium">PAN</th>
          <th className="py-2 pr-2 text-right font-medium">Taxable</th>
          <th className="py-2 pr-2 text-right font-medium">VAT</th>
          <th className="py-2 text-right font-medium">Total</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => (
          <tr key={`${row.doc_type}:${row.invoice_no}`} className="border-b border-slate-100">
            <td className="py-2 pr-2 font-medium">
              {row.invoice_no}
              {row.doc_type === 'RETURN' ? (
                <span className="ml-1 rounded bg-slate-200 px-1 text-xs text-slate-600">CN</span>
              ) : null}
            </td>
            <td className="py-2 pr-2">{row.business_date_bs}</td>
            <td className="py-2 pr-2 text-slate-600">{row.customer_name ?? 'Walk-in'}</td>
            <td className="py-2 pr-2 text-slate-600">{row.customer_pan ?? '—'}</td>
            <td className="py-2 pr-2 text-right">{money(row.taxable_amount)}</td>
            <td className="py-2 pr-2 text-right">{money(row.vat_amount)}</td>
            <td className="py-2 text-right">{money(row.total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <TotalsRow totals={data.totals} colSpan={4} />
      </tfoot>
    </table>
  );
}

function PurchaseRegister({ data }: { data: VatRegister<PurchaseVatRow> }) {
  if (data.rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">No purchase VAT bills in this range.</p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
          <th className="py-2 pr-2 font-medium">Invoice</th>
          <th className="py-2 pr-2 font-medium">Date (BS)</th>
          <th className="py-2 pr-2 font-medium">Supplier</th>
          <th className="py-2 pr-2 font-medium">PAN</th>
          <th className="py-2 pr-2 text-right font-medium">Taxable</th>
          <th className="py-2 pr-2 text-right font-medium">VAT</th>
          <th className="py-2 text-right font-medium">Total</th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row) => (
          <tr key={row.invoice_no} className="border-b border-slate-100">
            <td className="py-2 pr-2 font-medium">{row.invoice_no}</td>
            <td className="py-2 pr-2">{row.bill_date_bs}</td>
            <td className="py-2 pr-2 text-slate-600">{row.supplier_name}</td>
            <td className="py-2 pr-2 text-slate-600">{row.supplier_pan ?? '—'}</td>
            <td className="py-2 pr-2 text-right">{money(row.taxable_amount)}</td>
            <td className="py-2 pr-2 text-right">{money(row.vat_amount)}</td>
            <td className="py-2 text-right">{money(row.total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <TotalsRow totals={data.totals} colSpan={4} />
      </tfoot>
    </table>
  );
}
