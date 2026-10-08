import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PackageSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/useAuth';
import { listCategories, listItems } from '@/features/catalog/api';
import type { ItemListFilters } from '@/features/catalog/api';
import { ItemCard } from '@/features/catalog/ItemCard';
import { selectClasses } from '@/features/catalog/ui';
import { hasPermission } from '@/lib/permissions';

/**
 * The catalog — a storefront-style photo grid (2-up on phones, up to 5-up on
 * wide screens) with search, category, and status filters. Item management
 * (edit / deactivate) lives on the item detail page the cards link to.
 */
export function ItemsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = hasPermission(user, 'catalog.manage');
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

  const items = itemsQuery.data?.data ?? [];
  const meta = itemsQuery.data?.meta ?? null;

  return (
    <main className="mx-auto max-w-6xl p-4">
      <PageHeader
        className="mb-4"
        title={t('catalog.items.title')}
        actions={
          canManage ? (
            <Button asChild size="sm">
              <Link to="/catalog/items/new">{t('catalog.items.new')}</Link>
            </Button>
          ) : undefined
        }
      />

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

      {itemsQuery.isError ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {itemsQuery.error instanceof Error
            ? itemsQuery.error.message
            : t('catalog.items.loadError')}
        </p>
      ) : null}

      {itemsQuery.isPending ? (
        <GridSkeleton label={t('common.loading')} />
      ) : itemsQuery.data && items.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={t('catalog.items.empty')}
          action={
            canManage
              ? { label: t('catalog.items.new'), onClick: () => navigate('/catalog/items/new') }
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              categoryName={item.category ? (categoryNames.get(item.category) ?? null) : null}
            />
          ))}
        </div>
      )}

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
    </main>
  );
}

/** Card-shaped placeholders while the first page loads. */
function GridSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border bg-card">
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
