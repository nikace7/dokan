import { create } from 'zustand';

import type { CreateSalePayload } from '@/features/billing/api';
import type { Paisa } from '@/lib/money';
import { addPaisa, multiplyPaisa, parseAmount } from '@/lib/money';

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
  /** The discount as typed, so a wrong one stays on screen to be fixed. */
  discountRaw?: string;
  /** The price as typed at the counter; sent with the sale, which checks its limits. */
  priceRaw?: string;
  /** Rate the price belongs to; a different selected rate makes it stale. */
  rateTypeId?: string | null;
  vatApplicable?: boolean;
}

/** What a lookup says one unit costs at a rate. */
export type LinePricing = Pick<CartLine, 'unitPricePaisa' | 'rateTypeId' | 'vatApplicable'>;

export interface CartCustomer {
  id: string;
  name: string;
  phone: string;
}

/** A sale sent to the server that has no definite answer yet. */
export interface UnconfirmedSale {
  payload: CreateSalePayload;
  key: string;
  /** Change to hand back, kept so a retry after a reload still shows it. */
  changePaisa?: Paisa;
}

export interface CartState {
  lines: CartLine[];
  customer: CartCustomer | null;
  /** Set when the cart was loaded from a parked bill (complete, not re-post). */
  heldSaleId: string | null;
  /** The parked bill's total as the server stored it. */
  heldTotalPaisa: Paisa | null;
  /** Changes with every bill, so inputs that belong to one bill can reset. */
  billNo: number;
  /** While set, the cart is locked: the server may already hold this bill. */
  unconfirmedSale: UnconfirmedSale | null;
  addLine: (line: CartLine) => void;
  removeLine: (variantId: string) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  setDiscount: (variantId: string, raw: string) => void;
  setPrice: (variantId: string, raw: string) => void;
  /** Apply the prices of a newly selected rate, by variant id. */
  reprice: (pricing: Record<string, LinePricing>) => void;
  setCustomer: (customer: CartCustomer | null) => void;
  setUnconfirmedSale: (sale: UnconfirmedSale | null) => void;
  /** Replace the cart with a parked bill's lines (resume flow). */
  resumeHeld: (
    heldSaleId: string,
    lines: CartLine[],
    customer: CartCustomer | null,
    heldTotalPaisa: Paisa,
  ) => void;
  clear: () => void;
}

const initialState = {
  lines: [] as CartLine[],
  customer: null as CartCustomer | null,
  heldSaleId: null as string | null,
  heldTotalPaisa: null as Paisa | null,
  unconfirmedSale: null as UnconfirmedSale | null,
};

/** Display-only line total: `qty × unit price − discount`, floored at zero. */
export function lineTotalPaisa(line: CartLine): Paisa {
  return Math.max(0, multiplyPaisa(line.unitPricePaisa, line.quantity) - line.discountPaisa);
}

/** Display-only bill total. The server computes the authoritative total. */
export function cartTotalPaisa(lines: readonly CartLine[]): Paisa {
  return addPaisa(...lines.map(lineTotalPaisa));
}

/** The total to charge: a parked bill keeps the total it was stored with. */
export function billTotalPaisa(state: Pick<CartState, 'lines' | 'heldTotalPaisa'>): Paisa {
  return state.heldTotalPaisa ?? cartTotalPaisa(state.lines);
}

/** 13% VAT on the taxable lines, half up like the server. */
export function vatPaisa(lines: readonly CartLine[]): Paisa {
  return Math.round((cartTotalPaisa(lines.filter((l) => l.vatApplicable)) * 13) / 100);
}

export function discountProblem(line: CartLine): 'invalid' | 'tooLarge' | null {
  if (line.discountRaw?.trim() && parseAmount(line.discountRaw) === null) return 'invalid';
  return line.discountPaisa > multiplyPaisa(line.unitPricePaisa, line.quantity) ? 'tooLarge' : null;
}

/** A line needs a price: the shop may have none set for this item at this rate. */
export function priceProblem(line: CartLine): 'invalid' | 'missing' | null {
  if (line.priceRaw?.trim() && parseAmount(line.priceRaw) === null) return 'invalid';
  return line.unitPricePaisa > 0 ? null : 'missing';
}

export const useCartStore = create<CartState>()((set) => ({
  ...initialState,
  billNo: 0,
  addLine: (line) =>
    set((state) => {
      const existing = state.lines.find((l) => l.variantId === line.variantId);
      if (existing) {
        // Merging takes the newest price but keeps the existing discount —
        // re-scanning must not wipe one the counter already entered.
        const merged = {
          ...existing,
          ...line,
          quantity: existing.quantity + line.quantity,
          discountPaisa: existing.discountPaisa,
          discountRaw: existing.discountRaw,
          // Nor a price the counter typed.
          ...(existing.priceRaw === undefined
            ? {}
            : { priceRaw: existing.priceRaw, unitPricePaisa: existing.unitPricePaisa }),
        };
        return { lines: state.lines.map((l) => (l === existing ? merged : l)) };
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
  setDiscount: (variantId, raw) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.variantId === variantId
          ? { ...l, discountRaw: raw, discountPaisa: parseAmount(raw) ?? 0 }
          : l,
      ),
    })),
  setPrice: (variantId, raw) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.variantId === variantId
          ? { ...l, priceRaw: raw, unitPricePaisa: parseAmount(raw) ?? 0 }
          : l,
      ),
    })),
  reprice: (pricing) =>
    set((state) =>
      state.heldSaleId || state.unconfirmedSale
        ? state
        : {
            // A typed price stays when the rate changes.
            lines: state.lines.map((l) =>
              l.priceRaw === undefined ? { ...l, ...pricing[l.variantId] } : l,
            ),
          },
    ),
  setCustomer: (customer) => set({ customer }),
  setUnconfirmedSale: (unconfirmedSale) => set({ unconfirmedSale }),
  resumeHeld: (heldSaleId, lines, customer, heldTotalPaisa) =>
    set((state) => ({
      heldSaleId,
      lines,
      customer,
      heldTotalPaisa,
      unconfirmedSale: null,
      billNo: state.billNo + 1,
    })),
  clear: () => set((state) => ({ ...initialState, billNo: state.billNo + 1 })),
}));
