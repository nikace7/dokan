import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { TableCell } from '@/components/ui/table';
import { deactivateItem, listCategories, listItems } from '@/features/catalog/api';
import type { Item, ItemListFilters } from '@/features/catalog/api';
import { selectClasses } from '@/features/catalog/ui';
import { ReportTable } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';

/**
 * Items list — search (name/code), category and status filters, paged.
 * Deactivate is a soft delete (DELETE flips `is_active` server-side).
 */
export function ItemsPage() {
  const { t } = useTranslation();
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

  const columns: readonly ReportColumn[] = [
    { header: t('catalog.items.columns.code') },
    { header: t('catalog.items.columns.name') },
    { header: t('catalog.items.columns.category') },
    { header: t('catalog.items.columns.unit') },
    { header: t('catalog.items.columns.status') },
    { header: t('catalog.items.columns.actions'), className: 'text-right' },
  ];

  const itemActions = (item: Item) => (
    <div className="flex items-center justify-end gap-3 whitespace-nowrap">
      <Link to={`/catalog/items/${item.id}`} className="text-sm text-primary hover:underline">
        {t('catalog.items.open')}
      </Link>
      {item.is_active ? (
        <button
          type="button"
          className="text-sm text-destructive hover:underline disabled:text-muted-foreground"
          disabled={deactivateMutation.isPending}
          onClick={() => deactivateMutation.mutate(item.id)}
        >
          {t('catalog.items.deactivate')}
        </button>
      ) : null}
    </div>
  );

  return (
    <main className="mx-auto max-w-6xl p-4">
      <Card
        title={t('catalog.items.title')}
        actions={
          <Button asChild size="sm">
            <Link to="/catalog/items/new">{t('catalog.items.new')}</Link>
          </Button>
        }
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_160px]">
          <Input
            aria-label={t('catalog.items.searchAria')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t('catalog.items.searchPlaceholder')}
          />
          <select
            aria-label={t('catalog.items.filterCategory')}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className={selectClasses}
          >
            <option value="">{t('catalog.items.allCategories')}</option>
            {(categoriesQuery.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t('catalog.items.filterStatus')}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
            className={selectClasses}
          >
            <option value="active">{t('catalog.items.active')}</option>
            <option value="inactive">{t('catalog.items.inactive')}</option>
            <option value="all">{t('catalog.items.all')}</option>
          </select>
        </div>

        {itemsQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {itemsQuery.isError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
          >
            {itemsQuery.error instanceof Error
              ? itemsQuery.error.message
              : t('catalog.items.loadError')}
          </p>
        ) : null}

        {itemsQuery.data ? (
          <ReportTable
            columns={columns}
            rows={items}
            rowKey={(item) => item.id}
            empty={t('catalog.items.empty')}
            renderCells={(item) => (
              <>
                <TableCell className="font-medium">
                  <Link
                    className="text-primary hover:underline"
                    to={`/catalog/items/${item.id}`}
                  >
                    {item.code}
                  </Link>
                </TableCell>
                <TableCell>
                  {item.name}
                  {item.name_np ? (
                    <span className="ml-1 text-muted-foreground">{item.name_np}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.category ? (categoryNames.get(item.category) ?? '—') : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                <TableCell>
                  <Badge variant={item.is_active ? 'success' : 'secondary'}>
                    {item.is_active ? t('catalog.items.active') : t('catalog.items.inactive')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{itemActions(item)}</TableCell>
              </>
            )}
            renderCard={(item) => (
              <div className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <Link
                    className="font-medium text-primary hover:underline"
                    to={`/catalog/items/${item.id}`}
                  >
                    {item.code}
                  </Link>
                  <p className="truncate">
                    {item.name}
                    {item.name_np ? (
                      <span className="ml-1 text-muted-foreground">{item.name_np}</span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground">
                    {item.category ? (categoryNames.get(item.category) ?? '—') : '—'} · {item.unit}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge variant={item.is_active ? 'success' : 'secondary'}>
                    {item.is_active ? t('catalog.items.active') : t('catalog.items.inactive')}
                  </Badge>
                  {itemActions(item)}
                </div>
              </div>
            )}
          />
        ) : null}

        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('catalog.items.pageInfo', {
                page: meta.page,
                pages: meta.total_pages,
                count: meta.count,
              })}
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
    </main>
  );
}
