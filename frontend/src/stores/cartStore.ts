import { create } from 'zustand';

import type { Paisa } from '@/lib/money';

/**
 * Cart store skeleton for the billing screen.
 *
 * Zustand owns cart/UI state only — server state (items, prices, stock)
 * belongs to TanStack Query. Line prices are integer paisa resolved
 * server-side by the pricing rules; the client never computes discounts
 * beyond what the API returns.
 */
export interface CartLine {
  variantId: string;
  /** Display label captured at add time (name + size/colour). */
  label: string;
  quantity: number;
  unitPricePaisa: Paisa;
}

export interface CartState {
  lines: CartLine[];
  customerId: string | null;
  addLine: (line: CartLine) => void;
  removeLine: (variantId: string) => void;
  setCustomer: (customerId: string | null) => void;
  clear: () => void;
}

const initialState = {
  lines: [] as CartLine[],
  customerId: null as string | null,
};

export const useCartStore = create<CartState>()((set) => ({
  ...initialState,
  addLine: (line) =>
    set((state) => {
      const existing = state.lines.find((l) => l.variantId === line.variantId);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.variantId === line.variantId ? { ...l, quantity: l.quantity + line.quantity } : l,
          ),
        };
      }
      return { lines: [...state.lines, line] };
    }),
  removeLine: (variantId) =>
    set((state) => ({ lines: state.lines.filter((l) => l.variantId !== variantId) })),
  setCustomer: (customerId) => set({ customerId }),
  clear: () => set(initialState),
}));
