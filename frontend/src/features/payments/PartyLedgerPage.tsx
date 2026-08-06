import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { searchCustomers } from '@/features/billing/api';
import type { Customer } from '@/features/billing/api';
import { getCustomerLedger, getSupplierLedger } from '@/features/payments/api';
import type { LedgerRow } from '@/features/payments/api';
import { listSuppliers } from '@/features/purchasing/api';
import type { Supplier } from '@/features/purchasing/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

type Party = 'customer' | 'supplier';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

export function PartyLedgerPage() {
  const { t } = useTranslation();
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
      <Card title={t('payments.ledger.title')}>
        <div role="tablist" aria-label={t('payments.ledger.typeAria')} className="mb-4 flex gap-2">
          <Button
            role="tab"
            aria-selected={party === 'customer'}
            variant={party === 'customer' ? 'primary' : 'secondary'}
            onClick={() => selectParty('customer')}
          >
            {t('payments.ledger.customerTab')}
          </Button>
          <Button
            role="tab"
            aria-selected={party === 'supplier'}
            variant={party === 'supplier' ? 'primary' : 'secondary'}
            onClick={() => selectParty('supplier')}
          >
            {t('payments.ledger.supplierTab')}
          </Button>
        </div>

        {selectedId ? (
          <div className="flex items-center justify-between rounded-md border border-primary/30 bg-accent px-3 py-2">
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
              {t('common.change')}
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
          <p className="mt-4 text-sm text-muted-foreground">{t('payments.ledger.loading')}</p>
        ) : null}
        {ledgerQuery.isError ? (
          <p
            role="alert"
            className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {errorMessage(ledgerQuery.error, t('payments.ledger.loadError'))}
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
  const { t } = useTranslation();
  const search = party === 'customer' ? customerSearch : supplierSearch;
  return (
    <div>
      <Input
        label={party === 'customer' ? t('payments.customer') : t('payments.supplier')}
        aria-label={
          party === 'customer' ? t('payments.ledger.customerAria') : t('payments.ledger.supplierAria')
        }
        value={search}
        onChange={(event) =>
          party === 'customer'
            ? onCustomerSearch(event.target.value)
            : onSupplierSearch(event.target.value)
        }
        placeholder={
          party === 'customer'
            ? t('payments.ledger.customerPlaceholder')
            : t('payments.ledger.supplierPlaceholder')
        }
        autoComplete="off"
      />
      {results.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-popover">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => onSelect(result)}
              >
                <span className="font-medium">{result.name}</span>
                <span className="text-muted-foreground">{result.phone || '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Ledger rows: card list below `md`, full table from `md` up. */
function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p className="mt-4 py-8 text-center text-sm text-muted-foreground">
        {t('payments.ledger.empty')}
      </p>
    );
  }
  const balance = rows[rows.length - 1].balance;
  return (
    <div className="mt-4">
      <p className="mb-2 text-sm text-muted-foreground">
        {t('payments.ledger.closingBalance')}{' '}
        <strong className="text-foreground">{formatNpr(balance)}</strong>
      </p>
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row, index) => (
          <li key={`${row.date}-${row.kind}-${row.ref}-${index}`} className="py-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{row.ref}</span>
              <span className="font-semibold tabular-nums">{formatNpr(row.balance)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
              <span>{row.date}</span>
              <span>{row.kind}</span>
            </div>
            <div className="mt-1 flex gap-4 text-xs text-muted-foreground tabular-nums">
              <span>
                {t('payments.ledger.debit')} {formatNpr(row.debit, { symbol: '' })}
              </span>
              <span>
                {t('payments.ledger.credit')} {formatNpr(row.credit, { symbol: '' })}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('payments.ledger.date')}</TableHead>
              <TableHead>{t('payments.ledger.type')}</TableHead>
              <TableHead>{t('payments.ledger.reference')}</TableHead>
              <TableHead className="text-right">{t('payments.ledger.debit')}</TableHead>
              <TableHead className="text-right">{t('payments.ledger.credit')}</TableHead>
              <TableHead className="text-right">{t('payments.ledger.balance')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row.date}-${row.kind}-${row.ref}-${index}`}>
                <TableCell className="whitespace-nowrap">{row.date}</TableCell>
                <TableCell>{row.kind}</TableCell>
                <TableCell>{row.ref}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNpr(row.debit, { symbol: '' })}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNpr(row.credit, { symbol: '' })}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatNpr(row.balance)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
