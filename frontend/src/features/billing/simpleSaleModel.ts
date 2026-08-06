/**
 * Pure helpers for the simple-sale bill: line totals, range validation, and
 * the display grand total. The server remains authoritative for money —
 * these paisa figures are client-side display + pre-flight validation only.
 */

import type { VariantForSale } from '@/features/billing/api';
import { formatNpr, multiplyPaisa, toPaisa } from '@/lib/money';
import type { Paisa } from '@/lib/money';

/** One bill line as the counter edits it (inputs stay text until submit). */
export interface SimpleLine {
  key: string;
  variant: VariantForSale;
  /** Qty input text; whole pieces only. */
  qty: string;
  /** Unit price input text, rupees. */
  price: string;
}

/** Whole pieces on hand (`qty_on_hand` arrives as a decimal string). */
export function stockQty(variant: VariantForSale): number {
  return Math.floor(Number(variant.qty_on_hand));
}

/** Parsed unit price in paisa, or null when the input is not money. */
export function pricePaisa(line: SimpleLine): Paisa | null {
  try {
    return toPaisa(line.price);
  } catch {
    return null;
  }
}

/** Parsed quantity (positive whole number), or null. */
export function qtyPieces(line: SimpleLine): number | null {
  if (!/^\d+$/.test(line.qty.trim())) return null;
  const qty = Number(line.qty.trim());
  return Number.isSafeInteger(qty) && qty > 0 ? qty : null;
}

/** Display line total; null while the line is not computable. */
export function lineTotalPaisa(line: SimpleLine): Paisa | null {
  const price = pricePaisa(line);
  const qty = qtyPieces(line);
  if (price === null || qty === null) return null;
  return multiplyPaisa(price, qty);
}

/**
 * Client-side mirror of the server's min/max bounds: above-max is always
 * blocked and below-min needs an override the simple flow has no UI for, so
 * both are validation errors here. Null when the price is fine (or not yet
 * parseable — `qtyError`-style empty states are handled by the input).
 */
export function priceError(line: SimpleLine): string | null {
  const price = pricePaisa(line);
  if (price === null) return 'मूल्य राख्नुहोस् / Enter a price';
  const { min_selling_price: min, max_selling_price: max } = line.variant;
  if (min !== null && price < toPaisa(min)) {
    return `न्यूनतम मूल्य ${formatNpr(min)} / Min ${formatNpr(min)}`;
  }
  if (max !== null && price > toPaisa(max)) {
    return `अधिकतम मूल्य ${formatNpr(max)} / Max ${formatNpr(max)}`;
  }
  return null;
}

/** Null when the quantity is sellable against the branch stock. */
export function qtyError(line: SimpleLine): string | null {
  const qty = qtyPieces(line);
  if (qty === null) return 'परिमाण राख्नुहोस् / Enter a quantity';
  const stock = stockQty(line.variant);
  if (qty > stock) return `स्टकमा ${stock} मात्र छ / Only ${stock} in stock`;
  return null;
}

/** True when every line can go to the server as-is. */
export function linesValid(lines: SimpleLine[]): boolean {
  return lines.length > 0 && lines.every((line) => !priceError(line) && !qtyError(line));
}

/** Display grand total over computable lines (server totals rule). */
export function grandTotalPaisa(lines: SimpleLine[]): Paisa {
  return lines.reduce<Paisa>((sum, line) => sum + (lineTotalPaisa(line) ?? 0), 0);
}

/** The allowed-range hint shown under the price input, when bounds exist. */
export function priceRangeHint(variant: VariantForSale): string | null {
  const { min_selling_price: min, max_selling_price: max, mrp } = variant;
  if (min !== null && max !== null) {
    return `मूल्य दायरा: ${formatNpr(min)} – ${formatNpr(max)}`;
  }
  if (min !== null) return `न्यूनतम मूल्य: ${formatNpr(min)}`;
  if (max !== null) return `अधिकतम मूल्य: ${formatNpr(max)}`;
  return mrp !== null ? `MRP: ${formatNpr(mrp)}` : null;
}
