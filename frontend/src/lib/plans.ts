export type PlanFeature = 'profit_reports' | 'vat_module' | 'multi_branch';

interface PlanUser {
  plan: { features: Record<string, unknown> };
}

/** UI visibility only; the backend remains authoritative. */
export function hasPlanFeature(user: PlanUser | null | undefined, feature: PlanFeature): boolean {
  return user?.plan.features[feature] === true;
}
