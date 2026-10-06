import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { billNumber, getSale } from '@/features/billing/api';
import type { SalesInvoice } from '@/features/billing/api';
import { ReceiptPanel } from '@/features/billing/ReceiptPanel';
import { ShareBillPanel } from '@/features/billing/ShareBillPanel';
import { BillStatusBadge, DocTypeBadge } from '@/features/bills/BillBadges';
import { ReportError, TableSkeleton } from '@/features/reports/ui';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';
import { useCurrencyStore } from '@/stores/currency';

/**
 * One bill: who, when, every line, and how the total was reached — each
 * figure exactly as the server stored it (the client never re-derives
 * totals). Completed bills also get the printable receipt and share link.
 */
export function BillDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const query = useQuery({ queryKey: ['bills', 'detail', id], queryFn: () => getSale(id) });
  const bill = query.data;

  // Back keeps the list's filters (they live in its URL) when we came from it.
  const goBack = () => (location.key === 'default' ? navigate('/bills') : navigate(-1));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ArrowLeft aria-hidden="true" />
          {t('bills.back')}
        </Button>
      </div>
      {query.isPending ? <TableSkeleton /> : null}
      {query.isError ? (
        query.error instanceof ApiError && query.error.status === 404 ? (
          <Card>
            <p className="py-8 text-center text-sm text-muted-foreground">{t('bills.notFound')}</p>
          </Card>
        ) : (
          <ReportError error={query.error} />
        )
      ) : null}
      {bill ? <BillDetail bill={bill} /> : null}
    </main>
  );
}

function BillDetail({ bill }: { bill: SalesInvoice }) {
  const { t } = useTranslation();
  const number = billNumber(bill);
  const isCompleted = bill.status === 'COMPLETED';

  return (
    <>
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">
          {number ? t('bills.billTitle', { number }) : t(`bills.noNumber.${bill.status}`)}
        </h1>
        <BillStatusBadge status={bill.status} />
        <DocTypeBadge docType={bill.doc_type} />
      </header>
      <div
        className={`grid gap-4 ${isCompleted ? 'lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]' : ''}`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <BillFacts bill={bill} />
          <BillCalculation bill={bill} />
        </div>
        {isCompleted ? (
          // Block, not flex: both panels centre themselves with mx-auto.
          <div>
            <ReceiptPanel invoice={bill} />
            <ShareBillPanel invoice={bill} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function BillFacts({ bill }: { bill: SalesInvoice }) {
  const { t } = useTranslation();
  const createdAt = new Date(bill.created_at);
  return (
    <Card title={t('bills.detail.details')}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Fact label={t('bills.detail.date')}>
          {t('bills.detail.bsDate', { date: bill.business_date_bs })} ·{' '}
          <time dateTime={bill.created_at}>{createdAt.toLocaleString()}</time>
        </Fact>
        <Fact label={t('bills.detail.customer')}>{bill.customer_name ?? t('billing.walkIn')}</Fact>
        <Fact label={t('bills.detail.branch')}>{bill.branch_name}</Fact>
        <Fact label={t('bills.detail.cashier')}>{bill.created_by_name ?? '—'}</Fact>
        <Fact label={t('bills.detail.billKind')}>
          {bill.is_vat_bill ? t('bills.detail.vatBill') : t('bills.detail.normalBill')}
        </Fact>
        <Fact label={t('bills.detail.prints')}>{bill.print_count}</Fact>
        {bill.discount_reason ? (
          <Fact
            label={
              // Returns and exchanges keep their reason in the same column.
              bill.doc_type === 'SALE' ? t('bills.detail.discountReason') : t('bills.detail.reason')
            }
          >
            {bill.discount_reason}
          </Fact>
        ) : null}
      </dl>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function BillCalculation({ bill }: { bill: SalesInvoice }) {
  const { t } = useTranslation();
  // A bill is a legal document: always the shop's base currency, like the receipt.
  const base = useCurrencyStore((state) => state.base);
  const money = (amount: string) => formatNpr(amount, { currency: base });
  const plain = (amount: string) => formatNpr(amount, { symbol: '', currency: base });
  const isZero = (amount: string) => Number(amount) === 0;

  return (
    <Card title={t('bills.detail.itemsAndCalculation')}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="py-2 font-medium">{t('bills.detail.item')}</th>
              <th className="py-2 text-right font-medium">{t('bills.detail.qty')}</th>
              <th className="py-2 text-right font-medium">{t('bills.detail.rate')}</th>
              <th className="py-2 text-right font-medium">{t('bills.detail.lineDiscount')}</th>
              <th className="py-2 text-right font-medium">{t('bills.detail.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((item) => (
              <tr key={item.id} className="border-b border-border/60 align-top">
                <td className="py-2">
                  <span className="font-medium">{item.item_name}</span>{' '}
                  <span className="text-xs text-muted-foreground">{item.variant_sku}</span>
                  {item.item_name_np ? (
                    <span className="block text-xs">{item.item_name_np}</span>
                  ) : null}
                  {!isZero(item.returned_qty) ? (
                    <span className="block text-xs text-amber-700">
                      {t('bills.detail.returnedQty', { qty: Number(item.returned_qty) })}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 text-right tabular-nums">{Number(item.qty)}</td>
                <td className="py-2 text-right tabular-nums">{plain(item.unit_price)}</td>
                <td className="py-2 text-right tabular-nums">
                  {isZero(item.discount) ? '—' : `-${plain(item.discount)}`}
                </td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {plain(item.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto mt-4 max-w-sm space-y-1.5 text-sm">
        <Line label={t('bills.detail.subtotal')} value={money(bill.subtotal)} />
        {!isZero(bill.discount_amount) ? (
          <Line label={t('bills.detail.billDiscount')} value={`-${money(bill.discount_amount)}`} />
        ) : null}
        <Line label={t('bills.detail.taxable')} value={money(bill.taxable_amount)} />
        {bill.is_vat_bill ? (
          <Line label={t('bills.detail.vat')} value={money(bill.vat_amount)} />
        ) : null}
        {!isZero(bill.round_off) ? (
          <Line label={t('bills.detail.roundOff')} value={money(bill.round_off)} />
        ) : null}
        <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
          <dt>{t('bills.detail.total')}</dt>
          <dd className="tabular-nums">{money(bill.total)}</dd>
        </div>
        <Line label={t('bills.detail.paid')} value={money(bill.paid_amount)} />
        {bill.tenders.map((tender, index) => (
          <Line
            key={`${tender.method}-${index}`}
            label={`· ${tender.method}`}
            value={money(tender.amount)}
            muted
          />
        ))}
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t('bills.detail.due')}</dt>
          <dd
            className={`tabular-nums ${isZero(bill.due_amount) ? '' : 'font-semibold text-destructive'}`}
          >
            {money(bill.due_amount)}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'pl-3 text-xs text-muted-foreground' : ''}`}>
      <dt className={muted ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
