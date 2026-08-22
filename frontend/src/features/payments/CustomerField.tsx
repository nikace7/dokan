import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Customer } from '@/features/billing/api';
import { searchCustomers } from '@/features/payments/api';

/** Customer autocomplete for the receipt form: search input, or the selected party chip. */
export function CustomerField({
  customer,
  search,
  onSearch,
  onSelect,
  onClear,
}: {
  customer: Customer | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (value: Customer) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['payments', 'customers', search],
    queryFn: () => searchCustomers(search),
    enabled: search.trim().length >= 2 && !customer,
    staleTime: 30_000,
  });

  if (customer) {
    return (
      <div className="flex items-center justify-between rounded-md border border-primary/30 bg-accent px-3 py-2">
        <span className="text-sm">
          <strong>{customer.name}</strong>{' '}
          <span className="text-muted-foreground">{customer.phone}</span>
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={onClear}>
          {t('common.change')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Input
        label={t('payments.customer')}
        aria-label={t('payments.customerSearchAria')}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={t('common.searchByNameOrPhone')}
        autoComplete="off"
      />
      {query.isFetching ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('common.searching')}</p>
      ) : null}
      {query.data && query.data.length > 0 ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-popover">
          {query.data.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => onSelect(result)}
              >
                <span className="font-medium">{result.name}</span>
                <span className="text-muted-foreground">{result.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
