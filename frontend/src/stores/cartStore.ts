import { create } from 'zustand';

import type { Paisa } from '@/lib/money';
import { addPaisa, multiplyPaisa } from '@/lib/money';

/**
 * Cart store for the billing screen.
 *
 * Zustand owns cart/UI state only — server state (items, prices, stock)
 * belongs to TanStack Query. Line prices are integer paisa captured from
 * the variant lookup; discounts entered at the counter are sent to the
 * server, which is authoritative for every total — `cartTotalPaisa` is
 * display-only and never decides what the customer pays.
 */
export interface CartLine {
  variantId: string;
  sku: string;
  /** Display label captured at add time (name + size/colour). */
  label: string;
  quantity: number;
  unitPricePaisa: Paisa;
  /** Flat line discount in paisa (maps to `discount` on the sale line). */
  discountPaisa: Paisa;
}

export interface CartCustomer {
  id: string;
  name: string;
  phone: string;
}

export interface CartState {
  lines: CartLine[];
  customer: CartCustomer | null;
  /** Set when the cart was loaded from a parked bill (complete, not re-post). */
  heldSaleId: string | null;
  addLine: (line: CartLine) => void;
  removeLine: (variantId: string) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  setDiscount: (variantId: string, discountPaisa: Paisa) => void;
  setCustomer: (customer: CartCustomer | null) => void;
  /** Replace the cart with a parked bill's lines (resume flow). */
  resumeHeld: (heldSaleId: string, lines: CartLine[], customer: CartCustomer | null) => void;
  clear: () => void;
}

const initialState = {
  lines: [] as CartLine[],
  customer: null as CartCustomer | null,
  heldSaleId: null as string | null,
};

/** Display-only line total: `qty × unit price − discount`, floored at zero. */
export function lineTotalPaisa(line: CartLine): Paisa {
  return Math.max(0, multiplyPaisa(line.unitPricePaisa, line.quantity) - line.discountPaisa);
}

/** Display-only bill total. The server computes the authoritative total. */
export function cartTotalPaisa(lines: readonly CartLine[]): Paisa {
  return addPaisa(...lines.map(lineTotalPaisa));
}

export const useCartStore = create<CartState>()((set) => ({
  ...initialState,
  addLine: (line) =>
    set((state) => {
      const existing = state.lines.find((l) => l.variantId === line.variantId);
      if (existing) {
        // Merging keeps the existing line's discount — re-scanning an item
        // must not silently wipe a discount the counter already entered.
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
  setQuantity: (variantId, quantity) =>
    set((state) => ({
      lines:
        quantity <= 0
          ? state.lines.filter((l) => l.variantId !== variantId)
          : state.lines.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)),
    })),
  setDiscount: (variantId, discountPaisa) =>
    set((state) => ({
      lines: state.lines.map((l) => (l.variantId === variantId ? { ...l, discountPaisa } : l)),
    })),
  setCustomer: (customer) => set({ customer }),
  resumeHeld: (heldSaleId, lines, customer) => set({ heldSaleId, lines, customer }),
  clear: () => set(initialState),
}));
