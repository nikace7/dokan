/**
 * Money helpers (ARCHITECTURE §6 invariant 11).
 *
 * Rules:
 * - Money crosses this module as **integer paisa** (`Paisa`). One rupee =
 *   100 paisa. Floating-point money arithmetic is forbidden anywhere in the
 *   app; floats only ever appear at input boundaries and are immediately
 *   converted via `toPaisa` (string parsing, never `x * 100`).
 * - Display uses Nepali lakh/crore grouping: `1,23,456.00`.
 * - Devanagari numerals are an optional display preference (`२०८२`-style).
 * - Paisa enters in the tenant's BASE currency; formatting converts to the
 *   device's display currency (stores/currency) at the NRB peg. Pass
 *   `currency` explicitly for documents that must not follow the toggle
 *   (receipts always print in the base currency).
 */

import { CURRENCY_SYMBOLS, convertPaisa, useCurrencyStore } from '@/stores/currency';
import type { Currency } from '@/stores/currency';

/** Integer paisa. Always an integer; never a float amount of rupees. */
export type Paisa = number;

const PAISA_PER_RUPEE = 100;

const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'] as const;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Convert a rupee amount to integer paisa.
 *
 * Accepts a string (`"1234.56"`, preferred at input boundaries) or a number
 * (converted via `toFixed(2)` string parsing — never `amount * 100`, which
 * reintroduces float error).
 */
export function toPaisa(amount: number | string): Paisa {
  const text =
    typeof amount === 'number' ? validateNumberAmount(amount) : amount.trim().replace(/,/g, '');

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new MoneyError(`Invalid money amount: ${JSON.stringify(amount)}`);
  }
  const [, sign, rupees, fraction = ''] = match;
  const paisa = Number(rupees) * PAISA_PER_RUPEE + Number(fraction.padEnd(2, '0') || '0');
  const result = sign === '-' ? -paisa : paisa;
  if (!Number.isSafeInteger(result)) {
    throw new MoneyError(`Amount out of safe integer range: ${JSON.stringify(amount)}`);
  }
  return result;
}

/** A typed amount (zero or more) in paisa; null when it is not one. */
export function parseAmount(raw: string): Paisa | null {
  try {
    const paisa = toPaisa(raw.trim().replace(/\.$/, ''));
    return paisa < 0 ? null : paisa;
  } catch {
    return null;
  }
}

function validateNumberAmount(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new MoneyError(`Invalid money amount: ${String(amount)}`);
  }
  // toFixed rounds the binary float to its decimal representation; boundary
  // values like 1.005 are inherently ambiguous and should arrive as strings.
  return amount.toFixed(2);
}

/** Integer paisa arithmetic helpers — small, explicit, and float-free. */
export function addPaisa(...amounts: Paisa[]): Paisa {
  return amounts.reduce((sum, p) => sum + assertIntegerPaisa(p), 0);
}

export function multiplyPaisa(paisa: Paisa, quantity: number): Paisa {
  // Quantities carry up to three decimals (1.5 m of cloth): count in
  // thousandths to stay integer, then round half up to the paisa like the server.
  const thousandths = Math.round(quantity * 1000);
  if (!Number.isSafeInteger(thousandths) || Math.abs(quantity * 1000 - thousandths) > 1e-6) {
    throw new MoneyError(`Quantity must have at most three decimals, got ${String(quantity)}`);
  }
  return Math.round((assertIntegerPaisa(paisa) * thousandths) / 1000);
}

function assertIntegerPaisa(paisa: Paisa): Paisa {
  if (!Number.isSafeInteger(paisa)) {
    throw new MoneyError(`Paisa must be a safe integer, got ${String(paisa)}`);
  }
  return paisa;
}

/** Nepali lakh/crore grouping: `1234567` → `12,34,567`. */
function groupIndianStyle(intPart: string): string {
  const lastThree = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  if (rest === '') {
    return lastThree;
  }
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`;
}

export function toDevanagariDigits(text: string): string {
  return text.replace(/\d/g, (d) => DEVANAGARI_DIGITS[Number(d)]);
}

export interface FormatMoneyOptions {
  /** Render digits in Devanagari (default for locale=np). */
  devanagari?: boolean;
  /**
   * Currency symbol prefix. Default (null): none. `'auto'` follows the
   * target currency (रू for NPR, ₹ for INR); any other string is literal.
   */
  symbol?: string | null;
  /**
   * Target display currency (default: the device's current display
   * currency). Pass the base currency for legal documents (receipts).
   */
  currency?: Currency;
}

/** Format integer paisa as `1,23,456.00` (lakh/crore grouping). */
export function formatPaisa(paisa: Paisa, options: FormatMoneyOptions = {}): string {
  const { devanagari = false, symbol = null, currency } = options;
  const { base, display } = useCurrencyStore.getState();
  const target = currency ?? display;
  const value = convertPaisa(assertIntegerPaisa(paisa), base, target);

  const negative = value < 0;
  const abs = Math.abs(value);
  const rupees = Math.floor(abs / PAISA_PER_RUPEE).toString();
  const fraction = (abs % PAISA_PER_RUPEE).toString().padStart(2, '0');

  let formatted = `${groupIndianStyle(rupees)}.${fraction}`;
  if (devanagari) {
    formatted = toDevanagariDigits(formatted);
  }
  const prefix = negative ? '-' : '';
  const sign = symbol === 'auto' ? CURRENCY_SYMBOLS[target] : (symbol ?? '');
  return `${prefix}${sign}${formatted}`;
}

/** Convenience: format a rupee amount (`number | string`) for display. */
export function formatNpr(amount: number | string, options: FormatMoneyOptions = {}): string {
  return formatPaisa(toPaisa(amount), { symbol: 'auto', ...options });
}

/**
 * Format paisa in the shop's own currency, whatever the display toggle says.
 * Use it next to anything the user types: typed amounts are always base currency.
 */
export function formatBaseMoney(paisa: Paisa): string {
  return formatPaisa(paisa, { symbol: 'auto', currency: useCurrencyStore.getState().base });
}

/** Symbol of the shop's own currency, for input labels. */
export function baseSymbol(): string {
  return CURRENCY_SYMBOLS[useCurrencyStore.getState().base].trim();
}

/**
 * Subscribe the calling component to currency state so its `formatNpr` /
 * `formatPaisa` output re-renders when the NPR/INR toggle flips (or the base
 * currency loads from /auth/me).
 *
 * The formatters above read the store non-reactively (`getState()`) so they
 * stay callable anywhere — the price is that a component which renders
 * amounts MUST call this hook once at its top. Without it a currency change
 * only appears after the next unrelated re-render or a full page refresh.
 * Documents pinned to `currency: base` (receipts) may skip it.
 */
export function useMoneyDisplay(): void {
  useCurrencyStore((state) => state.base);
  useCurrencyStore((state) => state.display);
}
