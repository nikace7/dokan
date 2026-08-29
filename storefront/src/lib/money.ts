import type { StoreContent } from './api';

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

export interface ProductPriceView {
  /** What to render as the price. */
  text: string;
  /** Original price to strike through while an offer runs, else null. */
  compareAt: string | null;
}

interface PriceFields {
  price_min: string | null;
  price_max: string | null;
  website_price: string | null;
  website_compare_at: string | null;
}

/**
 * The one price rule of the storefront: a website price (already discounted
 * server-side when an offer runs) wins over the counter selling-price range.
 */
export function productPriceDisplay(
  product: PriceFields,
  currency: StorefrontCurrency,
): ProductPriceView {
  if (product.website_price !== null) {
    return {
      text: formatPriceRange(product.website_price, null, currency),
      compareAt:
        product.website_compare_at !== null
          ? formatPriceRange(product.website_compare_at, null, currency)
          : null,
    };
  }
  return { text: formatPriceRange(product.price_min, product.price_max, currency), compareAt: null };
}

/** "Tihar Sale · 20% off" from the tenant's offer settings; null when unset. */
export function offerLabel(store: StoreContent): string | null {
  const parts = [store.offer_text.trim()];
  if (store.offer_discount_pct !== null) {
    parts.push(`${String(Number(store.offer_discount_pct))}% off`);
  }
  const label = parts.filter(Boolean).join(' · ');
  return label === '' ? null : label;
}

/** "−15%" badge text for a discounted product; null when no offer applies. */
export function offerBadge(product: { offer_pct: string | null }): string | null {
  if (product.offer_pct === null) {
    return null;
  }
  const pct = Number(product.offer_pct);
  return Number.isFinite(pct) && pct > 0 ? `−${pct}%` : null;
}

/**
 * Urgency line for a scheduled offer: "Ends today" / "Ends in N days".
 * Null when the offer has no end date or the date can't be parsed. Compares
 * calendar dates, not instants — the offer runs through its last day.
 */
export function offerCountdown(offerEndsAt: string | null, now: Date = new Date()): string | null {
  if (offerEndsAt === null) {
    return null;
  }
  const end = new Date(`${offerEndsAt}T00:00:00`);
  if (Number.isNaN(end.getTime())) {
    return null;
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((end.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) {
    return null;
  }
  return days === 0 ? 'Ends today' : `Ends in ${days} day${days === 1 ? '' : 's'}`;
}
