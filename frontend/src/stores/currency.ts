import { create } from 'zustand';

/**
 * Display-currency state (NPR/INR).
 *
 * Amounts are always stored and exchanged in the tenant's base currency
 * (from /auth/me); `display` is a per-device viewing preference, persisted
 * like the language choice. Conversion uses the Nepal Rastra Bank peg —
 * 1 INR = 1.6 NPR (mirrors core/money.py NPR_PER_INR).
 */

export type Currency = 'NPR' | 'INR';

export const NPR_PER_INR = 1.6;

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  NPR: 'रू ',
  INR: '₹ ',
};

const STORAGE_KEY = 'dokan-currency';

function storedDisplay(): Currency | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'NPR' || value === 'INR' ? value : null;
  } catch {
    return null;
  }
}

/** Integer-paisa conversion at the official peg; same-currency is a no-op. */
export function convertPaisa(paisa: number, from: Currency, to: Currency): number {
  if (from === to) {
    return paisa;
  }
  return to === 'INR' ? Math.round(paisa / NPR_PER_INR) : Math.round(paisa * NPR_PER_INR);
}

interface CurrencyState {
  /** The tenant's money currency — what every amount is stored in. */
  base: Currency;
  /** What this device is viewing in. */
  display: Currency;
  setBase: (currency: Currency) => void;
  setDisplay: (currency: Currency) => void;
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  base: 'NPR',
  display: storedDisplay() ?? 'NPR',
  setBase: (base) => set(() => ({ base, display: storedDisplay() ?? base })),
  setDisplay: (display) => {
    try {
      localStorage.setItem(STORAGE_KEY, display);
    } catch {
      // Private mode etc. — session-only preference is fine.
    }
    set({ display });
  },
}));
