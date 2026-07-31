/**
 * Runtime configuration (Vite env).
 *
 * Tenant resolution never comes from here — the tenant is always derived
 * from the request host (AGENTS.md invariant 4). These values are demo
 * defaults only.
 */

/**
 * TODO: the backend has no branch/rate-type list endpoint yet. Until one
 * lands, the billing screen posts sales against the seeded demo branch and
 * default rate type identified by these env vars. Remove this module's
 * billing section once `GET /branches` / `GET /pricing/rate-types` exist.
 */
export const demoConfig = {
  /** UUID of the seeded demo branch (`seed_demo`). */
  branchId: import.meta.env.VITE_DEMO_BRANCH_ID ?? '',
  /** UUID of the seeded default rate type (e.g. Retail). */
  rateTypeId: import.meta.env.VITE_DEMO_RATE_TYPE_ID ?? '',
} as const;

/** True when the demo billing IDs are configured; the billing screen checks this. */
export function isDemoBillingConfigured(): boolean {
  return demoConfig.branchId !== '' && demoConfig.rateTypeId !== '';
}
