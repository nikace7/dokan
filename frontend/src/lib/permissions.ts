/**
 * Permission helpers.
 *
 * The single source of truth for the permission catalog is the backend's
 * `core/permissions/catalog.py` (docs/SYSTEM_DESIGN.md §8.5). This union is a
 * compile-time placeholder mirroring that catalog; when the OpenAPI client
 * lands, generate this list from the backend instead of editing by hand.
 *
 * Enforcement is always server-side (four redundant layers); these helpers
 * only drive UI visibility — hidden ≠ forbidden.
 */

export type PermissionCodename =
  | 'sale.view'
  | 'sale.create'
  | 'sale.void'
  | 'sale.return'
  | 'sale.discount'
  | 'catalog.view'
  | 'catalog.manage'
  | 'pricing.view'
  | 'pricing.view_cost'
  | 'pricing.edit'
  | 'pricing.override_min'
  | 'pricing.set_bounds'
  | 'stock.view'
  | 'stock.adjust'
  | 'stock.purchase'
  | 'customer.view'
  | 'customer.manage'
  | 'customer.credit'
  | 'payment.receive'
  | 'payment.pay'
  | 'payment.view'
  | 'payment.reverse'
  | 'cash.manage'
  | 'expense.view'
  | 'expense.manage'
  | 'report.sales'
  | 'report.staff'
  | 'report.stock'
  | 'report.profit'
  | 'report.ledger'
  | 'report.cash'
  | 'report.vat'
  | 'report.expense'
  | 'user.manage'
  | 'settings.manage'
  | 'compliance.view';

/** Minimal user shape needed for permission checks. */
export interface PermissionUser {
  permissions: readonly string[];
}

/** True when the user holds the given permission codename. */
export function hasPermission(
  user: PermissionUser | null | undefined,
  codename: PermissionCodename,
): boolean {
  return user?.permissions.includes(codename) ?? false;
}

/** True only when every listed permission is held. */
export function hasAllPermissions(
  user: PermissionUser | null | undefined,
  codenames: readonly PermissionCodename[],
): boolean {
  return codenames.every((codename) => hasPermission(user, codename));
}
