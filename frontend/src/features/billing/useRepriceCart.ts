import { useQuery } from '@tanstack/react-query';

import { lookupVariant } from '@/features/billing/api';
import { linePricing } from '@/features/billing/cartModel';
import { useCartStore } from '@/stores/cartStore';

/**
 * Bring the cart to the selected rate. The server bills every line at that
 * rate, so a line priced at another one would show the wrong total; the sale
 * has to wait (`isStale`) until all lines match.
 */
export function useRepriceCart(rateTypeId: string | null) {
  const lines = useCartStore((s) => s.lines);
  const reprice = useCartStore((s) => s.reprice);
  // A parked bill keeps its stored prices; an unconfirmed one must not change.
  const isFixed = useCartStore((s) => s.heldSaleId !== null || s.unconfirmedSale !== null);
  const stale =
    isFixed || rateTypeId === null ? [] : lines.filter((line) => line.rateTypeId !== rateTypeId);

  const query = useQuery({
    queryKey: ['billing', 'reprice', rateTypeId, stale.map((line) => line.variantId)],
    queryFn: async () => {
      const found = await Promise.all(
        stale.map(async (line) => {
          const variant = await lookupVariant(line.sku, rateTypeId);
          if (variant.id !== line.variantId) throw new Error(`Ambiguous code ${line.sku}`);
          return [line.variantId, linePricing(variant, rateTypeId)] as const;
        }),
      );
      reprice(Object.fromEntries(found));
      return null;
    },
    enabled: stale.length > 0,
    // Offline falls back to the cached price instead of waiting.
    networkMode: 'always',
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  return {
    isStale: stale.length > 0,
    error: stale.length > 0 && !query.isFetching ? query.error : null,
    retry: () => void query.refetch(),
  };
}
