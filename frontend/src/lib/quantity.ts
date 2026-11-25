/** A stock quantity for reading: "10.000" → "10", "2.500" → "2.5", none → "—". */
export function formatQty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return String(value);
  return quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}
