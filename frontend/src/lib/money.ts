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
 */

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
  if (!Number.isSafeInteger(quantity)) {
    throw new MoneyError(`Quantity must be a safe integer, got ${String(quantity)}`);
  }
  return assertIntegerPaisa(paisa) * quantity;
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
  /** Prefix with the NPR currency symbol. Default: `"रू "`; pass `""` to omit. */
  symbol?: string | null;
}

/** Format integer paisa as `1,23,456.00` (lakh/crore grouping). */
export function formatPaisa(paisa: Paisa, options: FormatMoneyOptions = {}): string {
  const { devanagari = false, symbol = null } = options;
  const value = assertIntegerPaisa(paisa);

  const negative = value < 0;
  const abs = Math.abs(value);
  const rupees = Math.floor(abs / PAISA_PER_RUPEE).toString();
  const fraction = (abs % PAISA_PER_RUPEE).toString().padStart(2, '0');

  let formatted = `${groupIndianStyle(rupees)}.${fraction}`;
  if (devanagari) {
    formatted = toDevanagariDigits(formatted);
  }
  const prefix = negative ? '-' : '';
  const currency = symbol === null ? '' : symbol;
  return `${prefix}${currency}${formatted}`;
}

/** Convenience: format a rupee amount (`number | string`) for display. */
export function formatNpr(amount: number | string, options: FormatMoneyOptions = {}): string {
  return formatPaisa(toPaisa(amount), { symbol: 'रू ', ...options });
}
