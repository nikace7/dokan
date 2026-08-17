/**
 * catalog — items, variants (size × colour), categories, brands, barcodes.
 *
 * Owns the item lookup hot path (`GET /items/lookup?barcode=`) used by the
 * billing screen. Cost price must never render for users without the
 * `pricing.view_cost` permission (ARCHITECTURE §6 invariant 10).
 */
export {};
