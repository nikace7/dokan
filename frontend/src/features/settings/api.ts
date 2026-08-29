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
  /** The shop's money currency; display conversion is a view preference. */
  currency: 'NPR' | 'INR';
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

export interface Role {
  id: string;
  code: string;
  name: string;
  name_np: string | null;
  is_system: boolean;
  description: string | null;
  permission_codes: string[];
}

export interface Permission {
  code: string;
  module: string;
  name: string;
  description: string | null;
  is_sensitive: boolean;
}

export interface CreateRolePayload {
  code: string;
  name: string;
  description?: string;
  permission_codes: string[];
}

export interface UpdateRolePayload {
  name?: string;
  description?: string | null;
  permission_codes: string[];
}

export interface StaffRoleAssignment {
  id: string;
  assignment_id: string;
  code: string;
  name: string;
  branch_id: string | null;
  branch_code: string | null;
}

export interface StaffUser {
  id: string;
  phone: string;
  email: string | null;
  full_name: string;
  is_active: boolean;
  must_change_password: boolean;
  roles: StaffRoleAssignment[];
}

export interface CreateStaffPayload {
  phone: string;
  full_name: string;
  email?: string;
  password: string;
  role: string;
  branch?: string | null;
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
      | 'currency'
    >
  >,
): Promise<TenantSettings> {
  return authedRequest<TenantSettings>('/v1/settings', { method: 'PATCH', body: payload });
}

export function listRoles(): Promise<Page<Role>> {
  return authedRequestPage<Role>('/v1/roles?limit=200');
}

export function listPermissions(): Promise<Permission[]> {
  return authedRequest<Permission[]>('/v1/permissions');
}

export function createRole(payload: CreateRolePayload): Promise<Role> {
  return authedRequest<Role>('/v1/roles', { method: 'POST', body: payload });
}

export function updateRole(roleId: string, payload: UpdateRolePayload): Promise<Role> {
  return authedRequest<Role>(`/v1/roles/${roleId}`, { method: 'PATCH', body: payload });
}

export function deleteRole(roleId: string): Promise<{ deleted: string }> {
  return authedRequest<{ deleted: string }>(`/v1/roles/${roleId}`, { method: 'DELETE' });
}

export function listStaff(): Promise<Page<StaffUser>> {
  return authedRequestPage<StaffUser>('/v1/users?limit=200');
}

export interface StoreSettings {
  hero_title: string;
  hero_subtitle: string;
  announcement: string;
  offer_text: string;
  offer_discount_pct: string | null;
  /** Currency website prices are entered in and the store displays. */
  currency: 'NPR' | 'INR';
  /** Read-only platform decisions, shown for context. */
  shopfront_subdomain: string | null;
  template: string;
  store_url: string | null;
  ecommerce_enabled: boolean;
  /** Setup-progress hints for the checklist. */
  active_items_count: number;
  website_price_count: number;
}

export type StoreSettingsPayload = Partial<
  Pick<
    StoreSettings,
    | 'hero_title'
    | 'hero_subtitle'
    | 'announcement'
    | 'offer_text'
    | 'offer_discount_pct'
    | 'currency'
  >
>;

export function getStoreSettings(): Promise<StoreSettings> {
  return authedRequest<StoreSettings>('/v1/storefront/settings');
}

export function updateStoreSettings(payload: StoreSettingsPayload): Promise<StoreSettings> {
  return authedRequest<StoreSettings>('/v1/storefront/settings', {
    method: 'PATCH',
    body: payload,
  });
}

export function createStaff(payload: CreateStaffPayload): Promise<StaffUser> {
  return authedRequest<StaffUser>('/v1/users', { method: 'POST', body: payload });
}

export function assignStaffRole(
  userId: string,
  role: string,
  branch: string | null = null,
): Promise<{ id: string; created: boolean; user: string; role: string; branch: string | null }> {
  return authedRequest(`/v1/users/${userId}/roles`, {
    method: 'POST',
    body: { role, branch },
  });
}

export function removeStaffRole(
  userId: string,
  assignmentId: string,
): Promise<{ revoked: string; user: string }> {
  return authedRequest(`/v1/users/${userId}/roles/${assignmentId}`, { method: 'DELETE' });
}
