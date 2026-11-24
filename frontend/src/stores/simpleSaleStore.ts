import { create } from 'zustand';

import type { PaymentMethod } from '@/features/billing/api';
import type { SimpleLine } from '@/features/billing/simpleSaleModel';
import type { UnconfirmedSale } from '@/stores/cartStore';

export type SimpleTender = Extract<PaymentMethod, 'CASH' | 'QR'>;

interface SimpleSaleState {
  lines: SimpleLine[];
  tender: SimpleTender;
  /**
   * Recorded BEFORE the sale is sent and kept until a definite answer, so a
   * retry after a lost reply re-sends the same bill under the same key.
   */
  unconfirmedSale: UnconfirmedSale | null;
  clear: () => void;
}

/** The Simple sale bill; lives here so leaving the screen does not empty it. */
export const useSimpleSaleStore = create<SimpleSaleState>()((set) => {
  const empty = { lines: [], tender: 'CASH' as const, unconfirmedSale: null };
  return { ...empty, clear: () => set(empty) };
});
