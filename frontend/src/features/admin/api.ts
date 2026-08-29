import { apiRequest } from '@/lib/api/client';
import type { Page } from '@/lib/api/client';
import { platformRequest, platformRequestPage } from '@/features/admin/authed';
import type { PlatformTokens } from '@/features/admin/tokens';

export type PlatformRole = 'SUPER_ADMIN' | 'SUPPORT' | 'BILLING';

export interface PlatformUser {
  id: string;
  email: string;
  full_name: string;
  role: PlatformRole;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  price_npr: string;
  billing_cycle: 'monthly' | 'yearly';
  limits: Record<string, unknown>;
  features: Record<string, unknown>;
  is_active: boolean;
  sort_order: number;
}

export type PlanPayload = Omit<Plan, 'id'>;

export type TenantStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  name_np?: string | null;
  legal_name?: string | null;
  pan_vat_no?: string | null;
  vat_registered?: boolean;
  plan: string;
  plan_code: string;
  plan_name: string;
  status: TenantStatus;
  trial_ends_at: string | null;
  timezone?: string;
  calendar_pref: 'BS' | 'AD' | 'BOTH';
  locale: 'np' | 'en';
  currency: 'NPR' | 'INR';
  shopfront_subdomain: string | null;
  onboarded_at?: string | null;
  created_at: string;
}

export interface TenantCreatePayload {
  slug: string;
  name: string;
  plan: string;
  status: TenantStatus;
  trial_ends_at?: string | null;
  owner_phone: string;
  owner_full_name: string;
  owner_email?: string | null;
  owner_password: string;
  branch_code: string;
  branch_name: string;
}

export interface Subscription {
  id: string;
  tenant: string;
  plan: string;
  plan_code: string;
  period_start: string;
  period_end: string;
  amount_npr: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  payment_ref: string | null;
  invoice_url: string | null;
}

export interface UsageSnapshot {
  id: string;
  date: string;
  users: number;
  items: number;
  invoices_mtd: number;
  storage_mb: number;
  sms_used: number;
}

export interface FeatureOverride {
  id: string;
  key: string;
  value: unknown;
  expires_at: string | null;
  note: string | null;
}

export interface ImpersonationTarget {
  id: string;
  phone: string;
  full_name: string;
}

export interface ImpersonationSession {
  id: string;
  platform_user: string;
  platform_user_name: string;
  tenant: string;
  target_user_id: string;
  reason: string;
  scope: 'READ_ONLY' | 'READ_WRITE';
  started_at: string;
  expires_at: string;
  ended_at: string | null;
}

export interface PlatformAuditRow {
  id: string;
  platform_user: string;
  platform_user_name: string;
  action: string;
  tenant: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

function query(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const result = params.toString();
  return result ? `?${result}` : '';
}

export function platformLogin(
  email: string,
  password: string,
  otp: string,
): Promise<PlatformTokens> {
  return apiRequest<PlatformTokens>('/v1/admin/auth/token', {
    method: 'POST',
    body: { email, password, otp },
  });
}

export function fetchPlatformMe(): Promise<PlatformUser> {
  return platformRequest<PlatformUser>('/v1/admin/auth/me');
}

export function listPlans(includeInactive = true): Promise<Page<Plan>> {
  return platformRequestPage<Plan>(
    `/v1/admin/plans${query({ include_inactive: includeInactive })}`,
  );
}

export function createPlan(payload: PlanPayload): Promise<Plan> {
  return platformRequest<Plan>('/v1/admin/plans', { method: 'POST', body: payload });
}

export function updatePlan(id: string, payload: Partial<PlanPayload>): Promise<Plan> {
  return platformRequest<Plan>(`/v1/admin/plans/${id}`, { method: 'PATCH', body: payload });
}

export function listTenants(filters: {
  search?: string;
  status?: string;
  plan?: string;
  page?: number;
}): Promise<Page<Tenant>> {
  return platformRequestPage<Tenant>(`/v1/admin/tenants${query(filters)}`);
}

export function getTenant(id: string): Promise<Tenant> {
  return platformRequest<Tenant>(`/v1/admin/tenants/${id}`);
}

export function createTenant(payload: TenantCreatePayload): Promise<Tenant> {
  return platformRequest<Tenant>('/v1/admin/tenants', { method: 'POST', body: payload });
}

export function updateTenant(id: string, payload: Partial<Tenant>): Promise<Tenant> {
  return platformRequest<Tenant>(`/v1/admin/tenants/${id}`, { method: 'PATCH', body: payload });
}

export function listSubscriptions(tenantId: string): Promise<Page<Subscription>> {
  return platformRequestPage<Subscription>(`/v1/admin/tenants/${tenantId}/subscriptions`);
}

export function createSubscription(
  tenantId: string,
  payload: Omit<Subscription, 'id' | 'tenant' | 'plan_code'>,
): Promise<Subscription> {
  return platformRequest<Subscription>(`/v1/admin/tenants/${tenantId}/subscriptions`, {
    method: 'POST',
    body: payload,
  });
}

export function updateSubscription(
  tenantId: string,
  id: string,
  payload: Pick<Subscription, 'status' | 'payment_ref' | 'invoice_url'>,
): Promise<Subscription> {
  return platformRequest<Subscription>(`/v1/admin/tenants/${tenantId}/subscriptions/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}

export function listUsage(tenantId: string): Promise<Page<UsageSnapshot>> {
  return platformRequestPage<UsageSnapshot>(`/v1/admin/tenants/${tenantId}/usage`);
}

export function listOverrides(tenantId: string): Promise<Page<FeatureOverride>> {
  return platformRequestPage<FeatureOverride>(`/v1/admin/tenants/${tenantId}/overrides`);
}

export function setOverride(
  tenantId: string,
  payload: Omit<FeatureOverride, 'id'>,
): Promise<FeatureOverride> {
  return platformRequest<FeatureOverride>(`/v1/admin/tenants/${tenantId}/overrides`, {
    method: 'POST',
    body: payload,
  });
}

export function deleteOverride(tenantId: string, id: string): Promise<{ deleted: string }> {
  return platformRequest<{ deleted: string }>(`/v1/admin/tenants/${tenantId}/overrides/${id}`, {
    method: 'DELETE',
  });
}

export function listImpersonationTargets(tenantId: string): Promise<ImpersonationTarget[]> {
  return platformRequest<ImpersonationTarget[]>(`/v1/admin/tenants/${tenantId}/users`);
}

export function startImpersonation(
  tenantId: string,
  payload: { target_user: string; reason: string; scope: string; duration_minutes: number },
): Promise<{ session: ImpersonationSession; access: string; token_type: string }> {
  return platformRequest<{ session: ImpersonationSession; access: string; token_type: string }>(
    `/v1/admin/tenants/${tenantId}/impersonate`,
    {
      method: 'POST',
      body: payload,
    },
  );
}

export function endImpersonation(id: string): Promise<ImpersonationSession> {
  return platformRequest<ImpersonationSession>(`/v1/admin/impersonations/${id}/end`, {
    method: 'POST',
  });
}

export function listPlatformAudit(filters: {
  tenant?: string;
  action?: string;
  platform_user?: string;
  page?: number;
}): Promise<Page<PlatformAuditRow>> {
  return platformRequestPage<PlatformAuditRow>(`/v1/admin/audit${query(filters)}`);
}
