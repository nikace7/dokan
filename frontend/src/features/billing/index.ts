/**
 * billing — the POS / billing screen.
 *
 * The most optimized surface in the app (docs/SYSTEM_DESIGN.md §7.3):
 * barcode-first entry, keyboard-only flow, split payments (cash / eSewa /
 * Khalti / Fonepay QR / udharo), gapless IRD invoice numbers, mandatory
 * Idempotency-Key on POST /sales, and (Phase 3) offline tolerance.
 * Everything here is designed for speed at the counter — optimize nothing
 * else before this screen.
 */
export {};
