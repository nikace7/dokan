import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { confirmInvoice, listInvoices } from '@/features/purchasing/api';
import type { PurchaseInvoice, PurchaseInvoiceStatus } from '@/features/purchasing/api';
import { PurchaseInvoiceForm } from '@/features/purchasing/PurchaseInvoiceForm';
import { SuppliersPanel } from '@/features/purchasing/SuppliersPanel';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

const STATUS_BADGES: Record<PurchaseInvoiceStatus, string> = {
  DRAFT: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-slate-200 text-slate-600',
};

function StatusBadge({ status }: { status: PurchaseInvoiceStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGES[status]}`}>
      {status}
    </span>
  );
}

/** Expanded invoice: lines, totals, and the guarded DRAFT→CONFIRMED action. */
function InvoiceDetail({ invoice }: { invoice: PurchaseInvoice }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmMutation = useMutation({
    mutationFn: () => confirmInvoice(invoice.id),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['purchasing', 'invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory', 'levels'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not confirm the invoice.'),
  });

  return (
    <div className="px-2 py-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="py-1 pr-2 font-medium">Variant</th>
            <th className="py-1 pr-2 text-right font-medium">Qty</th>
            <th className="py-1 pr-2 text-right font-medium">Unit cost</th>
            <th className="py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="border-b border-slate-100">
              <td className="py-1.5 pr-2">
                {item.item_name} <span className="text-xs text-slate-500">{item.variant_sku}</span>
              </td>
              <td className="py-1.5 pr-2 text-right">{item.qty}</td>
              <td className="py-1.5 pr-2 text-right">
                {formatNpr(item.unit_cost, { symbol: '' })}
              </td>
              <td className="py-1.5 text-right">{formatNpr(item.line_total, { symbol: '' })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-1">
          <dt className="text-slate-500">Subtotal</dt>
          <dd>{formatNpr(invoice.subtotal)}</dd>
        </div>
        {invoice.is_vat_bill ? (
          <div className="flex gap-1">
            <dt className="text-slate-500">VAT</dt>
            <dd>{formatNpr(invoice.vat_amount)}</dd>
          </div>
        ) : null}
        <div className="flex gap-1 font-semibold">
          <dt>Total</dt>
          <dd>{formatNpr(invoice.total)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-slate-500">Paid</dt>
          <dd>{formatNpr(invoice.paid_amount)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-slate-500">Due</dt>
          <dd>{formatNpr(invoice.due_amount)}</dd>
        </div>
      </dl>

      {invoice.status === 'DRAFT' ? (
        <div className="mt-3">
          {confirming ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-sm text-amber-900">
                Confirm this purchase? It posts the stock into the ledger and updates cost (weighted
                average). This cannot be undone.
              </p>
              {error ? (
                <p role="alert" className="mt-1 text-sm text-red-600">
                  {error}
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate()}
                >
                  {confirmMutation.isPending ? 'Confirming…' : 'Yes, confirm'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)}>
              Confirm — post stock
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
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const invoicesQuery = useQuery({
    queryKey: ['purchasing', 'invoices', statusFilter, page],
    queryFn: () => listInvoices(statusFilter || undefined, page),
  });

  const invoices = invoicesQuery.data?.data ?? [];
  const meta = invoicesQuery.data?.meta ?? null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Card
        title="Purchase invoices / खरिद"
        actions={
          <Button size="sm" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Close form' : 'New purchase'}
          </Button>
        }
      >
        {showForm ? (
          <div className="mb-4 rounded-md border border-slate-200 p-3">
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
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        {invoicesQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {invoicesQuery.data && invoices.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No purchase invoices yet.</p>
        ) : null}

        {invoices.map((invoice) => (
          <div key={invoice.id} className="border-b border-slate-100 last:border-0">
            <button
              type="button"
              aria-expanded={expandedId === invoice.id}
              onClick={() => setExpandedId((cur) => (cur === invoice.id ? null : invoice.id))}
              className="flex w-full items-center justify-between gap-2 px-2 py-3 text-left text-sm hover:bg-slate-50"
            >
              <span className="font-medium">{invoice.invoice_no}</span>
              <span className="text-slate-600">{invoice.supplier_name}</span>
              <span className="text-slate-500">{invoice.bill_date_bs}</span>
              <span>{formatNpr(invoice.total)}</span>
              <StatusBadge status={invoice.status} />
            </button>
            {expandedId === invoice.id ? <InvoiceDetail invoice={invoice} /> : null}
          </div>
        ))}

        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Page {meta.page} of {meta.total_pages} ({meta.count} invoices)
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <SuppliersPanel />
    </main>
  );
}
