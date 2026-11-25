import { useQuery } from '@tanstack/react-query';

import { quoteReturn } from '@/features/returns/api';
import type { ReturnQuoteRequest } from '@/features/returns/api';
import { useDebounced } from '@/lib/useDebounced';

/**
 * The server's figures for exactly these lines, or none while they are still
 * being worked out — a figure for the lines before an edit is never returned.
 */
export function useReturnQuote(invoiceId: string, request: ReturnQuoteRequest | null) {
  const key = request ? JSON.stringify(request) : '';
  const settled = useDebounced(key);
  const query = useQuery({
    queryKey: ['return-quote', invoiceId, settled],
    queryFn: () => quoteReturn(invoiceId, JSON.parse(settled) as ReturnQuoteRequest),
    enabled: settled !== '',
    // What was bought back or owed elsewhere changes the answer.
    staleTime: 0,
    gcTime: 0,
  });
  const current = settled === key && !query.isFetching;
  return {
    /** Identifies the lines, so an amount typed for other lines can be dropped. */
    key,
    quote: current ? query.data : undefined,
    error: current ? query.error : null,
  };
}
