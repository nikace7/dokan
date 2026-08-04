import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';

export interface TenantSettings {
  id: string;
  slug: string;
  name: string;
  name_np: string | null;
  legal_name: string | null;
  pan_vat_no: string | null;
  vat_registered: boolean;
  timezone: string;
  calendar_pref: 'BS' | 'AD' | 'BOTH';
  locale: 'np' | 'en';
  status: string;
  plan_code: string;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  name_np: string | null;
  address: string | null;
  phone: string | null;
  invoice_prefix: string;
  is_default: boolean;
  is_active: boolean;
}

export interface RateType {
  id: string;
  code: string;
  name: string;
  name_np: string | null;
  is_default: boolean;
  sort_order: number;
  default_margin_pct: string | null;
  required_permission: string | null;
  is_active: boolean;
}

export function listBranches(): Promise<Page<Branch>> {
  return authedRequestPage<Branch>('/v1/branches?is_active=true&limit=200');
}

export function listRateTypes(): Promise<Page<RateType>> {
  return authedRequestPage<RateType>('/v1/pricing/rate-types?is_active=true&limit=200');
}

export function getTenantSettings(): Promise<TenantSettings> {
  return authedRequest<TenantSettings>('/v1/settings');
}

export function updateTenantSettings(
  payload: Partial<
    Pick<
      TenantSettings,
      | 'name'
      | 'name_np'
      | 'legal_name'
      | 'pan_vat_no'
      | 'vat_registered'
      | 'calendar_pref'
      | 'locale'
    >
  >,
): Promise<TenantSettings> {
  return authedRequest<TenantSettings>('/v1/settings', { method: 'PATCH', body: payload });
}
