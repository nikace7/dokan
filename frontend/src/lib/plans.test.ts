import { describe, expect, it } from 'vitest';

import { billingPath, hasPlanFeature, PLAN_FEATURE_CATALOG } from '@/lib/plans';

function userWith(features: Record<string, unknown>) {
  return { plan: { code: 'pro', name: 'Pro', features } };
}

describe('hasPlanFeature', () => {
  it('is true only for an explicit boolean true', () => {
    const user = userWith({ advanced_pos: true, sms: 'yes', vat_module: false });
    expect(hasPlanFeature(user, 'advanced_pos')).toBe(true);
    expect(hasPlanFeature(user, 'sms')).toBe(false);
    expect(hasPlanFeature(user, 'vat_module')).toBe(false);
    expect(hasPlanFeature(user, 'multi_branch')).toBe(false);
  });

  it('is false without a user', () => {
    expect(hasPlanFeature(null, 'advanced_pos')).toBe(false);
    expect(hasPlanFeature(undefined, 'advanced_pos')).toBe(false);
  });
});

describe('billingPath', () => {
  it('points to the classic POS only with advanced_pos', () => {
    expect(billingPath(userWith({ advanced_pos: true }))).toBe('/billing');
    expect(billingPath(userWith({ advanced_pos: false }))).toBe('/billing/simple');
    expect(billingPath(userWith({}))).toBe('/billing/simple');
    expect(billingPath(null)).toBe('/billing/simple');
  });
});

describe('PLAN_FEATURE_CATALOG', () => {
  it('covers every feature key with a label and description', () => {
    for (const entry of PLAN_FEATURE_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
    const keys = PLAN_FEATURE_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('simple_sale');
    expect(keys).toContain('advanced_pos');
  });
});
