import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/skeleton';
import { getSharedBill } from '@/features/billing/api';
import type { SharedBill } from '@/features/billing/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

/**
 * The public online bill (`/bill/:token`) — no auth, no app shell. Anyone
 * holding the (unguessable) link reads exactly the receipt payload the shop
 * shared; nothing else on the tenant is reachable from here.
 */
export function SharedBillPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const query = useQuery({
    queryKey: ['shared-bill', token],
    queryFn: () => getSharedBill(token as string),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });

  if (query.isPending) {
    return (
      <Shell>
        <div role="status" aria-label="Loading bill" className="space-y-3">
          <Skeleton className="mx-auto h-8 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Shell>
    );
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Shell>
        <div className="text-center">
          <h1 className="text-lg font-semibold">
            {notFound ? t('sharedBill.notFound') : t('sharedBill.loadError')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {notFound ? t('sharedBill.notFoundHelp') : t('sharedBill.loadErrorHelp')}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <BillCard bill={query.data} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-muted/40 px-4 py-6">
      <div className="mx-auto max-w-md">{children}</div>
      <footer className="mx-auto mt-6 max-w-md text-center">
        <p className="text-xs text-muted-foreground">
          Powered by{' '}
          <Link to="/" className="font-medium text-primary hover:underline">
            mero-pasal.online
          </Link>{' '}
          — मेरो पसल
        </p>
      </footer>
    </main>
  );
}

function BillCard({ bill }: { bill: SharedBill }) {
  const { t } = useTranslation();
  const invoiceNumber = `${bill.doc_type === 'RETURN' ? 'RET' : bill.invoice_prefix}-${bill.invoice_no}`;
  return (
    <Card>
      <div className="text-center">
        <h1 className="text-xl font-bold">{bill.tenant_name}</h1>
        {bill.tenant_name_np ? <p className="font-medium">{bill.tenant_name_np}</p> : null}
        {bill.legal_name ? <p className="text-xs text-muted-foreground">{bill.legal_name}</p> : null}
        <p className="text-xs text-muted-foreground">
          {bill.branch_name}
          {bill.branch_address ? ` · ${bill.branch_address}` : ''}
          {bill.branch_phone ? ` · ${bill.branch_phone}` : ''}
        </p>
        {bill.pan_vat_no ? (
          <p className="text-xs text-muted-foreground">PAN/VAT: {bill.pan_vat_no}</p>
        ) : null}
        <p className="mt-2 text-xs font-semibold uppercase">
          {bill.is_vat_bill ? t('sharedBill.taxInvoice') : t('sharedBill.invoice')}
        </p>
        <h2 className="mt-1 text-2xl font-bold">{t('sharedBill.invoiceNumber', { number: invoiceNumber })}</h2>
        <p className="mt-1 text-sm">
          BS {bill.business_date_bs} · FY {bill.fiscal_year_bs}
          {bill.customer_name ? ` · ${bill.customer_name}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">AD {bill.business_date_ad}</p>
      </div>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="py-1 font-medium">{t('sharedBill.item')}</th>
            <th className="py-1 text-right font-medium">{t('sharedBill.qty')}</th>
            <th className="py-1 text-right font-medium">{t('sharedBill.rate')}</th>
            <th className="py-1 text-right font-medium">{t('sharedBill.total')}</th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((item) => (
            <tr key={item.id} className="border-b border-border/60">
              <td className="py-1.5">
                {item.item_name}{' '}
                <span className="text-xs text-muted-foreground">{item.variant_sku}</span>
                {item.item_name_np ? (
                  <span className="block text-xs text-muted-foreground">{item.item_name_np}</span>
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
        <Row label={t('sharedBill.subtotal')} value={bill.subtotal} />
        {bill.discount_amount !== '0.00' ? (
          <Row label={t('sharedBill.discount')} value={`-${bill.discount_amount}`} />
        ) : null}
        {bill.is_vat_bill ? <Row label={t('sharedBill.vat')} value={bill.vat_amount} /> : null}
        {bill.round_off !== '0.00' ? <Row label={t('sharedBill.roundOff')} value={bill.round_off} /> : null}
        <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
          <dt>{t('sharedBill.total')}</dt>
          <dd>{formatNpr(bill.total)}</dd>
        </div>
        <Row label={t('sharedBill.paid')} value={bill.paid_amount} />
        {bill.tenders.map((tender, index) => (
          <Row
            key={`${tender.method}-${index}`}
            label={`${t('sharedBill.tender')} · ${tender.method}`}
            value={tender.amount}
          />
        ))}
        {bill.due_amount !== '0.00' ? (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('sharedBill.dueUdharo')}</dt>
            <dd className="font-semibold text-destructive">{formatNpr(bill.due_amount)}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-4 text-center text-xs text-muted-foreground">{t('sharedBill.thankYou')}</p>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{formatNpr(value)}</dd>
    </div>
  );
}
