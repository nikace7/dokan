/**
 * Offline barcode/SKU lookup cache.
 *
 * Every successful online lookup from the billing screen is written here;
 * when the network is down, lookup falls back to these rows. This is a
 * read-through cache of data the counter already fetched — the service
 * worker deliberately knows nothing about API responses.
 *
 * Staleness note: the server prices every bill itself, so a stale cached
 * price can never mis-price a completed bill.
 */

import { offlineDb } from '@/lib/offline/db';
import type { VariantLookup } from '@/features/billing/api';

/** Cache a variant after a successful online lookup. Fire-and-forget. */
export async function cacheVariant(
  variant: VariantLookup,
  rateTypeId?: string | null,
): Promise<void> {
  await offlineDb.transaction('rw', offlineDb.variantCache, async () => {
    const known = await offlineDb.variantCache.get(variant.id);
    await offlineDb.variantCache.put({
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode || null,
      size: variant.size,
      color: variant.color,
      mrp: variant.mrp,
      prices: {
        ...known?.prices,
        ...(rateTypeId && variant.price ? { [rateTypeId]: variant.price } : {}),
      },
      vatApplicable: variant.item__is_vat_applicable,
      itemName: variant.item__name,
      cachedAt: new Date().toISOString(),
    });
  });
}

/**
 * Offline lookup by barcode, then SKU — mirrors the online lookup order.
 * Returns undefined on a cache miss.
 */
export async function lookupCachedVariant(
  code: string,
  rateTypeId?: string | null,
): Promise<VariantLookup | undefined> {
  const byBarcode = await offlineDb.variantCache.where('barcode').equals(code).first();
  const row = byBarcode ?? (await offlineDb.variantCache.where('sku').equals(code).first());
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode ?? '',
    size: row.size,
    color: row.color,
    color_hex: '',
    mrp: row.mrp,
    price: rateTypeId ? row.prices?.[rateTypeId] : undefined,
    item__is_vat_applicable: row.vatApplicable,
    is_active: true,
    item__name: row.itemName,
    item__name_np: '',
    item__code: '',
  };
}
