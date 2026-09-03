export type PlanFeature =
  | 'sms'
  | 'profit_reports'
  | 'export_excel'
  | 'vat_module'
  | 'multi_branch'
  | 'custom_rate_types'
  | 'simple_sale'
  | 'advanced_pos'
  | 'ecommerce';

interface PlanUser {
  plan?: { features?: Record<string, unknown> };
}

/** UI visibility only; the backend remains authoritative. */
export function hasPlanFeature(user: PlanUser | null | undefined, feature: PlanFeature): boolean {
  return user?.plan?.features?.[feature] === true;
}

/**
 * Every known boolean plan feature, with a friendly label and a one-line
 * description for Nepali retail users. Drives the platform-admin toggles.
 */
export const PLAN_FEATURE_CATALOG: readonly {
  key: PlanFeature;
  label: string;
  description: string;
}[] = [
  {
    key: 'simple_sale',
    label: 'Simple sale',
    description: 'A stripped-down counter screen: pick items, take payment, done.',
  },
  {
    key: 'advanced_pos',
    label: 'Advanced POS',
    description: 'Full barcode billing with held bills, exchanges, and split tenders.',
  },
  {
    key: 'ecommerce',
    label: 'Online store',
    description: 'Public product catalog, customer checkout, tracking, and online-order inbox.',
  },
  {
    key: 'sms',
    label: 'SMS receipts',
    description: 'Send sale receipts and dues reminders to customer mobiles by SMS.',
  },
  {
    key: 'profit_reports',
    label: 'Profit reports',
    description: 'Cost-based profit reports for the owner, hidden from counter staff.',
  },
  {
    key: 'export_excel',
    label: 'Excel exports',
    description: 'Download report data as Excel workbooks for filing and analysis.',
  },
  {
    key: 'vat_module',
    label: 'VAT billing',
    description: 'VAT invoices and the sales/purchase VAT registers needed for IRD filing.',
  },
  {
    key: 'multi_branch',
    label: 'Multi-branch',
    description: 'Run several branches with stock transfers between them.',
  },
  {
    key: 'custom_rate_types',
    label: 'Custom rate types',
    description: 'Extra price lists beyond retail, e.g. wholesale or staff rates.',
  },
];

/** Where the Billing nav entry points, given the plan's POS mode. */
export function billingPath(user: PlanUser | null | undefined): '/billing' | '/billing/simple' {
  return hasPlanFeature(user, 'advanced_pos') ? '/billing' : '/billing/simple';
}
