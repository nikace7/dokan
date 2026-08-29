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

/**
 * Paged product feed for the grid. Refetches from page 1 whenever the
 * category or (debounced) query changes; "Load more" appends the next page.
 */
export function useProducts(category: string | null, query: string): UseProductsResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProducts({ category: category ?? undefined, q: query || undefined, page: 1 })
      .then((page) => {
        if (cancelled) return;
        setProducts(page.data);
        setMeta(page.meta);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProducts([]);
        setMeta(null);
        setError(err instanceof Error ? err.message : 'Could not load products.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, query, attempt]);

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
      .then((page) => {
        setProducts((current) => [...current, ...page.data]);
        setMeta(page.meta);
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }, [category, query, meta]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    products,
    meta,
    loading,
    loadingMore,
    error,
    hasMore: meta !== null && meta.page < meta.total_pages,
    loadMore,
    retry,
  };
}
