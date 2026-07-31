import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { SalesInvoice } from '@/features/billing/api';
import { formatNpr } from '@/lib/money';

interface ReceiptPanelProps {
  invoice: SalesInvoice;
  onNewBill: () => void;
}

/**
 * Post-sale receipt. Every figure here comes from the server's response —
 * the client never re-derives invoice totals.
 */
export function ReceiptPanel({ invoice, onNewBill }: ReceiptPanelProps) {
  return (
    <Card className="mx-auto max-w-lg">
      <div className="text-center">
        <p className="text-sm font-medium text-green-700">Sale completed</p>
        <h2 className="mt-1 text-2xl font-bold">Invoice {invoice.invoice_no}</h2>
        <p className="mt-1 text-sm text-slate-500">
          BS {invoice.business_date_bs} · FY {invoice.fiscal_year_bs}
          {invoice.customer_name ? ` · ${invoice.customer_name}` : ''}
        </p>
      </div>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="py-1 font-medium">Item</th>
            <th className="py-1 text-right font-medium">Qty</th>
            <th className="py-1 text-right font-medium">Rate</th>
            <th className="py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="py-1.5">
                {item.item_name} <span className="text-xs text-slate-500">{item.variant_sku}</span>
              </td>
              <td className="py-1.5 text-right">{item.qty}</td>
              <td className="py-1.5 text-right">{formatNpr(item.unit_price, { symbol: '' })}</td>
              <td className="py-1.5 text-right">{formatNpr(item.line_total, { symbol: '' })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-3 space-y-1 text-sm">
        <Row label="Subtotal" value={invoice.subtotal} />
        {invoice.discount_amount !== '0.00' ? (
          <Row label="Discount" value={`-${invoice.discount_amount}`} />
        ) : null}
        {invoice.is_vat_bill ? <Row label="VAT" value={invoice.vat_amount} /> : null}
        {invoice.round_off !== '0.00' ? <Row label="Round off" value={invoice.round_off} /> : null}
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
          <dt>Total</dt>
          <dd>{formatNpr(invoice.total)}</dd>
        </div>
        <Row label="Paid" value={invoice.paid_amount} />
        <div className="flex justify-between">
          <dt className="text-slate-600">Due (udharo)</dt>
          <dd className={invoice.due_amount !== '0.00' ? 'font-semibold text-red-600' : ''}>
            {formatNpr(invoice.due_amount)}
          </dd>
        </div>
      </dl>

      <Button size="lg" className="mt-6 w-full" onClick={onNewBill} autoFocus>
        New bill / नयाँ बिल
      </Button>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-600">{label}</dt>
      <dd>{formatNpr(value)}</dd>
    </div>
  );
}
