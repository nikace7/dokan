import { useQuery } from '@tanstack/react-query';

import { Input } from '@/components/ui/Input';
import {
  listCustomerAllocationInvoices,
  listSupplierAllocationInvoices,
} from '@/features/payments/api';
import type { AllocationInvoice } from '@/features/payments/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr, toPaisa } from '@/lib/money';

export type AllocationParty = 'customer' | 'supplier';

export function InvoiceAllocationPicker({
  party,
  partyId,
  values,
  onChange,
}: {
  party: AllocationParty;
  partyId: string;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  const query = useQuery({
    queryKey: ['payments', 'allocation-invoices', party, partyId],
    queryFn: () =>
      party === 'customer'
        ? listCustomerAllocationInvoices(partyId)
        : listSupplierAllocationInvoices(partyId),
  });
  const invoices = query.data ?? [];
  const total = Object.values(values).reduce((sum, amount) => {
    try {
      return sum + toPaisa(amount);
    } catch {
      return sum;
    }
  }, 0);

  return (
    <div className="rounded-md border border-border bg-muted/50 p-3 sm:col-span-2">
      <p className="text-sm font-medium">Allocate against invoices (optional)</p>
      {query.isFetching ? (
        <p className="mt-1 text-xs text-muted-foreground">Loading open invoices…</p>
      ) : null}
      {query.isError ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {query.error instanceof ApiError || query.error instanceof Error
            ? query.error.message
            : 'Could not load open invoices.'}
        </p>
      ) : null}
      {query.data && invoices.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          No open invoices. The payment can remain unallocated.
        </p>
      ) : null}
      {invoices.length > 0 ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {invoices.map((invoice) => (
            <AllocationField
              key={invoice.id}
              invoice={invoice}
              value={values[invoice.id] ?? ''}
              onChange={(value) => onChange({ ...values, [invoice.id]: value })}
            />
          ))}
        </div>
      ) : null}
      {total > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Allocated: {formatNpr(total)}</p>
      ) : null}
    </div>
  );
}

function AllocationField({
  invoice,
  value,
  onChange,
}: {
  invoice: AllocationInvoice;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = `Allocation for invoice ${invoice.invoice_no ?? '—'}`;
  return (
    <Input
      label={label}
      aria-label={label}
      type="number"
      min="0"
      max={invoice.outstanding}
      step="0.01"
      value={value}
      placeholder={`Open ${formatNpr(invoice.outstanding, { symbol: '' })}`}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
