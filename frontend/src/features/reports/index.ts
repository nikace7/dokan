/**
 * reports — sales, stock, VAT, and udharo reports.
 *
 * BS-native: date ranges are picked in Bikram Sambat and sent as AD ISO
 * strings (report endpoints additionally accept date_from_bs / date_to_bs).
 * Large reports return `202 + job_id` and poll. Profit reports require the
 * `report.profit` permission.
 */
export {};
