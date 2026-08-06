import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { searchCustomers } from '@/features/billing/api';
import { useCartStore } from '@/stores/cartStore';

/**
 * Udharo customer picker. The selected customer lives in the cart store so
 * it rides along with hold/resume and is cleared with the bill.
 */
export function CustomerPicker() {
  const { t } = useTranslation();
  const customer = useCartStore((s) => s.customer);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['customers', 'search', search],
    queryFn: () => searchCustomers(search),
    enabled: search.trim().length >= 2,
    staleTime: 30_000,
  });

  if (customer) {
    return (
      <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
        <div className="text-sm">
          <span className="font-medium text-slate-900">{customer.name}</span>{' '}
          <span className="text-slate-500">{customer.phone}</span>
        </div>
        <button
          type="button"
          className="rounded px-2 py-1 text-sm text-blue-700 hover:bg-blue-100"
          onClick={() => setCustomer(null)}
        >
          {t('billing.change')}
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        aria-label="Search customers"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('billing.customerSearchPlaceholder')}
        autoComplete="off"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {query.isFetching ? (
        <p className="mt-1 text-xs text-slate-500">{t('billing.searching')}</p>
      ) : null}
      {query.data && query.data.length > 0 ? (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {query.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  setCustomer({ id: c.id, name: c.name, phone: c.phone });
                  setSearch('');
                }}
              >
                <span className="font-medium text-slate-900">{c.name}</span>
                <span className="text-slate-500">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {query.data && query.data.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">{t('billing.noCustomersMatch')}</p>
      ) : null}
    </div>
  );
}
