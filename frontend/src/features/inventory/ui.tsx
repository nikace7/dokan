/**
 * Native `<select>` styling on the design-system tokens — mirrors the Input
 * primitive so form rows line up. Kept as a plain class string because the
 * Radix select would change the option/keyboard semantics these screens
 * (and their tests) rely on. Local copy: features do not share files.
 */
export const selectClasses = [
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

/** Compact inline input for table/card cells (quantities, notes). */
export const cellInputClasses = [
  'h-9 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
].join(' ');
