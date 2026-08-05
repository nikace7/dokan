import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  default_rate_type: string | null;
  credit_limit: string | null;
  opening_balance: string;
  loyalty_points: string;
  birthday_bs: string | null;
  gender: string | null;
  note: string | null;
  is_active: boolean;
}

export interface CustomerPayload {
  name: string;
  phone?: string | null;
  address?: string | null;
  default_rate_type?: string | null;
  credit_limit?: string | null;
  opening_balance?: string;
  birthday_bs?: string | null;
  gender?: string | null;
  note?: string | null;
}

export function listCustomers(
  filters: {
    search?: string;
    isActive?: boolean;
    page?: number;
  } = {},
): Promise<Page<Customer>> {
  const params = new URLSearchParams({ page: String(filters.page ?? 1), limit: '25' });
  if (filters.search) params.set('search', filters.search);
  if (filters.isActive !== undefined) params.set('is_active', String(filters.isActive));
  return authedRequestPage<Customer>(`/v1/customers?${params}`);
}

export function createCustomer(payload: CustomerPayload): Promise<Customer> {
  return authedRequest<Customer>('/v1/customers', { method: 'POST', body: payload });
}

export function updateCustomer(id: string, payload: CustomerPayload): Promise<Customer> {
  return authedRequest<Customer>(`/v1/customers/${id}`, { method: 'PATCH', body: payload });
}

export function deactivateCustomer(id: string): Promise<{ id: string; is_active: false }> {
  return authedRequest(`/v1/customers/${id}`, { method: 'DELETE' });
}
