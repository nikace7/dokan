import { useCallback, useEffect, useState } from 'react';

import { getProducts } from '../lib/api';
import type { PageMeta, Product } from '../lib/api';

interface UseProductsResult {
  products: Product[];
  meta: PageMeta | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

interface LoadedPage {
  /** requestKey of the first-page request this data belongs to. */
  key: string | null;
  products: Product[];
  meta: PageMeta | null;
  error: string | null;
}

/**
 * Paged product feed for the grid. Refetches from page 1 whenever the
 * category or (debounced) query changes; "Load more" appends the next page.
 *
 * `loading`/`error` are derived from whether the last resolved request matches
 * the current one, so the effect never sets state synchronously
 * (react-hooks/set-state-in-effect).
 */
export function useProducts(category: string | null, query: string): UseProductsResult {
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([category, query, attempt]);
  const [page, setPage] = useState<LoadedPage>({ key: null, products: [], meta: null, error: null });
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getProducts({ category: category ?? undefined, q: query || undefined, page: 1 })
      .then((result) => {
        if (cancelled) return;
        setPage({ key: requestKey, products: result.data, meta: result.meta, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPage({
          key: requestKey,
          products: [],
          meta: null,
          error: err instanceof Error ? err.message : 'Could not load products.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [category, query, requestKey]);

  const loading = page.key !== requestKey;
  const meta = page.meta;

  const loadMore = useCallback(() => {
    if (!meta || meta.page >= meta.total_pages) {
      return;
    }
    setLoadingMore(true);
    getProducts({
      category: category ?? undefined,
      q: query || undefined,
      page: meta.page + 1,
    })
      .then((result) => {
        setPage((current) => ({
          ...current,
          products: [...current.products, ...result.data],
          meta: result.meta,
        }));
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }, [category, query, meta]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    products: page.products,
    meta,
    loading,
    loadingMore,
    error: loading ? null : page.error,
    hasMore: meta !== null && meta.page < meta.total_pages,
    loadMore,
    retry,
  };
}
