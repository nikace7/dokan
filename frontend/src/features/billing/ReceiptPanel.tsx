import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { recordReceiptPrint } from '@/features/billing/api';
import type { SalesInvoice } from '@/features/billing/api';
import { formatNpr } from '@/lib/money';

interface ReceiptPanelProps {
  invoice: SalesInvoice;
  onNewBill: () => void;
}

/**
 * Post-sale receipt. Every figure here comes from the server's response —
 * the client never re-derives invoice totals.
 *
 * The receipt BODY is deliberately bilingual ("Invoice / बिल", fixed 80mm
 * print layout) and does NOT go through i18n — only the screen-only chrome
 * (Sale completed, Reprint, New bill) is translated.
 */
export function ReceiptPanel({ invoice, onNewBill }: ReceiptPanelProps) {
  const { t } = useTranslation();
  const [printCount, setPrintCount] = useState(invoice.print_count);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const autoPrintStarted = useRef(false);
  const printInFlight = useRef(false);
  const invoiceNumber = `${invoice.doc_type === 'RETURN' ? 'RET' : invoice.invoice_prefix}-${invoice.invoice_no}`;

  const printReceipt = useCallback(async () => {
    if (printInFlight.current) return;
    printInFlight.current = true;
    setIsPrinting(true);
    try {
      const result = await recordReceiptPrint(invoice.id);
      flushSync(() => setPrintCount(result.print_count));
      setPrintError(null);
    } catch {
      setPrintError(t('billing.receipt.printHistoryError'));
    } finally {
      window.print();
      printInFlight.current = false;
      setIsPrinting(false);
    }
  }, [invoice.id, t]);

  useEffect(() => {
    if (autoPrintStarted.current) return;
    autoPrintStarted.current = true;
    void printReceipt();
  }, [printReceipt]);

  return (
    <Card id="sales-receipt" className="mx-auto max-w-lg">
      <div className="receipt-screen-only text-center">
        <p className="text-sm font-medium text-green-700">{t('billing.receipt.saleCompleted')}</p>
      </div>
      <div className="text-center">
        <h1 className="text-xl font-bold">{invoice.tenant_name}</h1>
        {invoice.tenant_name_np ? <p className="font-medium">{invoice.tenant_name_np}</p> : null}
        {invoice.legal_name ? <p className="text-xs">{invoice.legal_name}</p> : null}
        <p className="text-xs">
          {invoice.branch_name}
          {invoice.branch_address ? ` · ${invoice.branch_address}` : ''}
          {invoice.branch_phone ? ` · ${invoice.branch_phone}` : ''}
        </p>
        {invoice.pan_vat_no ? <p className="text-xs">PAN/VAT: {invoice.pan_vat_no}</p> : null}
        <p className="mt-2 text-xs font-semibold uppercase">
          {invoice.is_vat_bill ? 'Tax Invoice / कर बिजक' : 'Invoice / बिल'}
        </p>
        <h2 className="mt-1 text-2xl font-bold">Invoice {invoiceNumber}</h2>
        <p className="mt-1 text-sm">
          BS {invoice.business_date_bs} · FY {invoice.fiscal_year_bs}
          {invoice.customer_name ? ` · ${invoice.customer_name}` : ''}
        </p>
        <p className="text-xs text-slate-500">AD {invoice.business_date_ad}</p>
        {printCount > 1 ? <p className="mt-1 text-xs font-semibold">Copy {printCount}</p> : null}
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
                {item.item_name_np ? (
                  <span className="block text-xs">{item.item_name_np}</span>
                ) : null}
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
        {invoice.tenders.map((tender, index) => (
          <Row
            key={`${tender.method}-${index}`}
            label={`Tender · ${tender.method}`}
            value={tender.amount}
          />
        ))}
        <div className="flex justify-between">
          <dt className="text-slate-600">Due (udharo)</dt>
          <dd className={invoice.due_amount !== '0.00' ? 'font-semibold text-red-600' : ''}>
            {formatNpr(invoice.due_amount)}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-center text-xs">Thank you / धन्यवाद</p>

      <div className="receipt-actions mt-6 grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          size="lg"
          disabled={isPrinting}
          onClick={() => void printReceipt()}
        >
          {isPrinting ? t('billing.receipt.printing') : t('billing.receipt.reprint')}
        </Button>
        <Button size="lg" onClick={onNewBill} autoFocus>
          {t('billing.receipt.newBill')}
        </Button>
      </div>
      {printError ? (
        <p role="alert" className="receipt-screen-only mt-3 text-sm text-amber-700">
          {printError}
        </p>
      ) : null}
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
