import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { deactivateItem, listCategories, listItems } from '@/features/catalog/api';
import type { ItemListFilters } from '@/features/catalog/api';

/**
 * Items list — search (name/code), category and status filters, paged.
 * Deactivate is a soft delete (DELETE flips `is_active` server-side).
 */
export function ItemsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [page, setPage] = useState(1);

  const filters: ItemListFilters = {
    search: search.trim() || undefined,
    category: category || undefined,
    isActive: status === 'all' ? undefined : status === 'active',
    page,
  };

  const itemsQuery = useQuery({
    queryKey: ['catalog', 'items', 'list', filters],
    queryFn: () => listItems(filters),
  });

  const categoriesQuery = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: listCategories,
    staleTime: 5 * 60_000,
  });
  const categoryNames = new Map(
    (categoriesQuery.data?.data ?? []).map((c) => [c.id, c.name] as const),
  );

  const deactivateMutation = useMutation({
    mutationFn: deactivateItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalog', 'items'] }),
  });

  const items = itemsQuery.data?.data ?? [];
  const meta = itemsQuery.data?.meta ?? null;

  return (
    <main className="mx-auto max-w-6xl p-4">
      <Card
        title="Items / सामान"
        actions={
          <Link to="/catalog/items/new">
            <Button size="sm">New item</Button>
          </Link>
        }
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_160px]">
          <input
            aria-label="Search items"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or code…"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All categories</option>
            {(categoriesQuery.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>

        {itemsQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {itemsQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {itemsQuery.error instanceof Error ? itemsQuery.error.message : 'Failed to load items.'}
          </p>
        ) : null}
        {itemsQuery.data && items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No items yet — create the first one.
          </p>
        ) : null}

        {items.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-2 font-medium">Code</th>
                <th className="py-2 pr-2 font-medium">Name</th>
                <th className="py-2 pr-2 font-medium">Category</th>
                <th className="py-2 pr-2 font-medium">Unit</th>
                <th className="py-2 pr-2 font-medium">Status</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="py-2 pr-2 font-medium">
                    <Link className="text-blue-700 hover:underline" to={`/catalog/items/${item.id}`}>
                      {item.code}
                    </Link>
                  </td>
                  <td className="py-2 pr-2">
                    {item.name}
                    {item.name_np ? <span className="ml-1 text-slate-500">{item.name_np}</span> : null}
                  </td>
                  <td className="py-2 pr-2 text-slate-600">
                    {item.category ? (categoryNames.get(item.category) ?? '—') : '—'}
                  </td>
                  <td className="py-2 pr-2 text-slate-600">{item.unit}</td>
                  <td className="py-2 pr-2">
                    <span
                      className={
                        item.is_active
                          ? 'rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800'
                          : 'rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600'
                      }
                    >
                      {item.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <Link
                      to={`/catalog/items/${item.id}`}
                      className="mr-3 text-sm text-blue-700 hover:underline"
                    >
                      Open
                    </Link>
                    {item.is_active ? (
                      <button
                        type="button"
                        className="text-sm text-red-600 hover:underline disabled:text-slate-400"
                        disabled={deactivateMutation.isPending}
                        onClick={() => deactivateMutation.mutate(item.id)}
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Page {meta.page} of {meta.total_pages} ({meta.count} items)
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
    </main>
  );
}
