import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { confirmInvoice, listInvoices } from '@/features/purchasing/api';
import type { PurchaseInvoice, PurchaseInvoiceStatus } from '@/features/purchasing/api';
import { PurchaseInvoiceForm } from '@/features/purchasing/PurchaseInvoiceForm';
import { StatusStepper } from '@/features/purchasing/StatusStepper';
import { SuppliersPanel } from '@/features/purchasing/SuppliersPanel';
import { ApiError } from '@/lib/api/client';
import { formatNpr, useMoneyDisplay } from '@/lib/money';

const STATUS_VARIANTS: Record<PurchaseInvoiceStatus, 'warning' | 'success' | 'secondary'> = {
  DRAFT: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'secondary',
};

const STATUS_KEYS: Record<PurchaseInvoiceStatus, string> = {
  DRAFT: 'purchasing.statusDraft',
  CONFIRMED: 'purchasing.statusConfirmed',
  CANCELLED: 'purchasing.statusCancelled',
};

function StatusBadge({ status }: { status: PurchaseInvoiceStatus }) {
  const { t } = useTranslation();
  return <Badge variant={STATUS_VARIANTS[status]}>{t(STATUS_KEYS[status])}</Badge>;
}

const selectClasses =
  'rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** Expanded invoice: lines, totals, and the guarded DRAFT→CONFIRMED action. */
function InvoiceDetail({ invoice }: { invoice: PurchaseInvoice }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useMoneyDisplay();

  const confirmMutation = useMutation({
    mutationFn: () => confirmInvoice(invoice.id),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['purchasing', 'invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory', 'levels'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('purchasing.detail.confirmError')),
  });

  return (
    <div className="px-2 py-3">
      {invoice.status === 'CANCELLED' ? (
        <StatusBadge status={invoice.status} />
      ) : (
        <StatusStepper status={invoice.status} />
      )}
      <ul className="mt-3 divide-y divide-border rounded-md border border-border px-3">
        {invoice.items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium">
                {item.item_name}{' '}
                <span className="text-xs text-muted-foreground">{item.variant_sku}</span>
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {item.qty} × {formatNpr(item.unit_cost, { symbol: '' })}
              </p>
            </div>
            <p className="tabular-nums">{formatNpr(item.line_total, { symbol: '' })}</p>
          </li>
        ))}
      </ul>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-1">
          <dt className="text-muted-foreground">{t('purchasing.detail.subtotal')}</dt>
          <dd>{formatNpr(invoice.subtotal)}</dd>
        </div>
        {invoice.is_vat_bill ? (
          <div className="flex gap-1">
            <dt className="text-muted-foreground">{t('purchasing.detail.vat')}</dt>
            <dd>{formatNpr(invoice.vat_amount)}</dd>
          </div>
        ) : null}
        <div className="flex gap-1 font-semibold">
          <dt>{t('purchasing.detail.total')}</dt>
          <dd>{formatNpr(invoice.total)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">{t('purchasing.detail.paid')}</dt>
          <dd>{formatNpr(invoice.paid_amount)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-muted-foreground">{t('purchasing.detail.due')}</dt>
          <dd>{formatNpr(invoice.due_amount)}</dd>
        </div>
      </dl>

      {invoice.status === 'DRAFT' ? (
        <div className="mt-3">
          {confirming ? (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
              <p className="text-sm text-warning">{t('purchasing.detail.confirmBody')}</p>
              {error ? (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate()}
                >
                  {confirmMutation.isPending
                    ? t('purchasing.detail.confirming')
                    : t('purchasing.detail.confirmYes')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                  {t('purchasing.detail.back')}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)}>
              {t('purchasing.detail.confirm')}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Purchasing screen: invoice list with status badges and the DRAFT→CONFIRM
 * flow, the new-invoice form, and supplier management.
 */
export function PurchasingPage() {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  useMoneyDisplay();

  const invoicesQuery = useQuery({
    queryKey: ['purchasing', 'invoices', statusFilter, page],
    queryFn: () => listInvoices(statusFilter || undefined, page),
  });

  const invoices = invoicesQuery.data?.data ?? [];
  const meta = invoicesQuery.data?.meta ?? null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Card
        title={t('purchasing.title')}
        actions={
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? t('common.closeForm') : t('purchasing.new')}
          </Button>
        }
      >
        {showForm ? (
          <div className="mb-4 rounded-md border border-border p-3">
            <PurchaseInvoiceForm
              onCreated={(invoice) => {
                setShowForm(false);
                setExpandedId(invoice.id);
              }}
              onCancel={() => setShowForm(false)}
            />
          </div>
        ) : null}

        <div className="mb-3">
          <select
            aria-label={t('purchasing.filterStatusAria')}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className={selectClasses}
          >
            <option value="">{t('purchasing.allStatuses')}</option>
            <option value="DRAFT">{t('purchasing.statusDraft')}</option>
            <option value="CONFIRMED">{t('purchasing.statusConfirmed')}</option>
            <option value="CANCELLED">{t('purchasing.statusCancelled')}</option>
          </select>
        </div>

        {invoicesQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {invoicesQuery.data && invoices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('purchasing.empty')}</p>
        ) : null}

        {invoices.map((invoice) => (
          <div key={invoice.id} className="border-b border-border last:border-0">
            <button
              type="button"
              aria-expanded={expandedId === invoice.id}
              onClick={() => setExpandedId((cur) => (cur === invoice.id ? null : invoice.id))}
              className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-2 py-3 text-left text-sm hover:bg-muted/50"
            >
              <span className="font-medium">{invoice.invoice_no}</span>
              <span className="text-muted-foreground">{invoice.supplier_name}</span>
              <span className="text-muted-foreground">{invoice.bill_date_bs}</span>
              <span className="tabular-nums">{formatNpr(invoice.total)}</span>
              <StatusBadge status={invoice.status} />
            </button>
            {expandedId === invoice.id ? <InvoiceDetail invoice={invoice} /> : null}
          </div>
        ))}

        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('common.pageOf', { page: meta.page, total: meta.total_pages })} (
              {t('purchasing.count', { count: meta.count })})
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('common.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <SuppliersPanel />
    </main>
  );
}
