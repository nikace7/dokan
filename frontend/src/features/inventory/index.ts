/**
 * inventory — stock levels, adjustments, transfers, counts.
 *
 * Includes the size × colour stock-entry matrix (docs/SYSTEM_DESIGN.md §7.4).
 * Stock changes only ever happen via the immutable stock_movement ledger on
 * the backend; this UI never edits quantities directly.
 */
export {};
