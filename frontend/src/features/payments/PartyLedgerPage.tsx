import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { searchCustomers } from '@/features/billing/api';
import type { Customer } from '@/features/billing/api';
import { getCustomerLedger, getSupplierLedger } from '@/features/payments/api';
import type { LedgerRow } from '@/features/payments/api';
import { listSuppliers } from '@/features/purchasing/api';
import type { Supplier } from '@/features/purchasing/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

type Party = 'customer' | 'supplier';

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Could not load the ledger.';
}

export function PartyLedgerPage() {
  const [party, setParty] = useState<Party>('customer');
  const [customerSearch, setCustomerSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const selectedId = party === 'customer' ? customer?.id : supplier?.id;
  const customerQuery = useQuery({
    queryKey: ['ledger', 'customers', customerSearch],
    queryFn: () => searchCustomers(customerSearch),
    enabled: party === 'customer' && customerSearch.trim().length >= 2 && !customer,
  });
  const supplierQuery = useQuery({
    queryKey: ['ledger', 'suppliers', supplierSearch],
    queryFn: () => listSuppliers(supplierSearch),
    enabled: party === 'supplier' && supplierSearch.trim().length >= 2 && !supplier,
  });
  const ledgerQuery = useQuery<LedgerRow[]>({
    queryKey: ['ledger', party, selectedId],
    queryFn: () =>
      party === 'customer' ? getCustomerLedger(selectedId!) : getSupplierLedger(selectedId!),
    enabled: Boolean(selectedId),
  });

  function selectParty(next: Party) {
    setParty(next);
    setCustomer(null);
    setSupplier(null);
    setCustomerSearch('');
    setSupplierSearch('');
  }

  const selectedName = party === 'customer' ? customer?.name : supplier?.name;
  const results =
    party === 'customer' ? (customerQuery.data ?? []) : (supplierQuery.data?.data ?? []);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <Card title="Party ledgers / खाता">
        <div role="tablist" aria-label="Ledger type" className="mb-4 flex gap-2">
          <Button
            role="tab"
            aria-selected={party === 'customer'}
            variant={party === 'customer' ? 'primary' : 'secondary'}
            onClick={() => selectParty('customer')}
          >
            Customer ledger
          </Button>
          <Button
            role="tab"
            aria-selected={party === 'supplier'}
            variant={party === 'supplier' ? 'primary' : 'secondary'}
            onClick={() => selectParty('supplier')}
          >
            Supplier ledger
          </Button>
        </div>

        {selectedId ? (
          <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
            <strong className="text-sm">{selectedName}</strong>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setCustomer(null);
                setSupplier(null);
              }}
            >
              Change
            </Button>
          </div>
        ) : (
          <PartySearch
            party={party}
            customerSearch={customerSearch}
            supplierSearch={supplierSearch}
            onCustomerSearch={setCustomerSearch}
            onSupplierSearch={setSupplierSearch}
            results={results}
            onSelect={(selected) => {
              if (party === 'customer') {
                setCustomer(selected as Customer);
                setCustomerSearch('');
              } else {
                setSupplier(selected as Supplier);
                setSupplierSearch('');
              }
            }}
          />
        )}

        {ledgerQuery.isFetching ? (
          <p className="mt-4 text-sm text-slate-500">Loading ledger…</p>
        ) : null}
        {ledgerQuery.isError ? (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {errorMessage(ledgerQuery.error)}
          </p>
        ) : null}
        {ledgerQuery.data ? <LedgerTable rows={ledgerQuery.data} /> : null}
      </Card>
    </main>
  );
}

function PartySearch({
  party,
  customerSearch,
  supplierSearch,
  onCustomerSearch,
  onSupplierSearch,
  results,
  onSelect,
}: {
  party: Party;
  customerSearch: string;
  supplierSearch: string;
  onCustomerSearch: (value: string) => void;
  onSupplierSearch: (value: string) => void;
  results: Array<Customer | Supplier>;
  onSelect: (party: Customer | Supplier) => void;
}) {
  const search = party === 'customer' ? customerSearch : supplierSearch;
  return (
    <div>
      <Input
        label={party === 'customer' ? 'Customer' : 'Supplier'}
        aria-label={`Search ${party} ledger`}
        value={search}
        onChange={(event) =>
          party === 'customer'
            ? onCustomerSearch(event.target.value)
            : onSupplierSearch(event.target.value)
        }
        placeholder={`Search ${party} by name or phone…`}
        autoComplete="off"
      />
      {results.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => onSelect(result)}
              >
                <span className="font-medium">{result.name}</span>
                <span className="text-slate-500">{result.phone || '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-4 py-8 text-center text-sm text-slate-500">No ledger entries yet.</p>;
  }
  const balance = rows[rows.length - 1].balance;
  return (
    <div className="mt-4">
      <p className="mb-2 text-sm text-slate-600">
        Closing balance: <strong>{formatNpr(balance)}</strong>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-2 font-medium">Date</th>
              <th className="py-2 pr-2 font-medium">Type</th>
              <th className="py-2 pr-2 font-medium">Reference</th>
              <th className="py-2 pr-2 text-right font-medium">Debit</th>
              <th className="py-2 pr-2 text-right font-medium">Credit</th>
              <th className="py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.date}-${row.kind}-${row.ref}-${index}`}
                className="border-b border-slate-100"
              >
                <td className="whitespace-nowrap py-2 pr-2">{row.date}</td>
                <td className="py-2 pr-2">{row.kind}</td>
                <td className="py-2 pr-2">{row.ref}</td>
                <td className="py-2 pr-2 text-right">{formatNpr(row.debit, { symbol: '' })}</td>
                <td className="py-2 pr-2 text-right">{formatNpr(row.credit, { symbol: '' })}</td>
                <td className="py-2 text-right font-semibold">{formatNpr(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
