/**
 * Price display for the storefront: ranges from the catalog resolve to a
 * single amount or an "Rs A – B" range; nothing set means "Price on request".
 * Money crosses the API as decimal strings ("1600.00"); grouping is en-IN
 * (lakh style) which matches both NPR and INR conventions.
 */

export type StorefrontCurrency = 'NPR' | 'INR';

const GROUPING = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function prefixFor(currency: StorefrontCurrency): string {
  return currency === 'INR' ? '₹' : 'Rs ';
}

function parseAmount(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAmount(amount: number): string {
  return GROUPING.format(amount);
}

/**
 * Render a product's price band.
 * - both bounds missing → "Price on request"
 * - one bound → that single amount
 * - equal bounds → single amount
 * - otherwise → "Rs 800 – 1,600" (prefix once, en dash)
 */
export function formatPriceRange(
  min: string | null,
  max: string | null,
  currency: StorefrontCurrency,
): string {
  const lo = parseAmount(min);
  const hi = parseAmount(max);
  const prefix = prefixFor(currency);

  if (lo === null && hi === null) {
    return 'Price on request';
  }
  if (lo === null) {
    return `${prefix}${formatAmount(hi as number)}`;
  }
  if (hi === null || lo === hi) {
    return `${prefix}${formatAmount(lo)}`;
  }
  const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
  return `${prefix}${formatAmount(from)} – ${formatAmount(to)}`;
}
