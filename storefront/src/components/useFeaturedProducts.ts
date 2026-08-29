import { useEffect, useState } from 'react';

import { getProducts } from '../lib/api';
import type { Product } from '../lib/api';

/**
 * The featured rail feed — one unfiltered fetch of website_featured items on
 * mount. Failures degrade silently to "no rail"; the main grid is untouched.
 */
export function useFeaturedProducts(): { products: Product[]; loading: boolean } {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getProducts({ featured: true })
      .then((page) => {
        if (cancelled) return;
        setProducts(page.data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { products, loading };
}
