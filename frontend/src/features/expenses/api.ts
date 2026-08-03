import { authedRequest, authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';

export interface ExpenseCategory {
  id: string;
  name: string;
  name_np: string | null;
  is_active: boolean;
}

export interface Expense {
  id: string;
  branch: string | null;
  branch_code: string | null;
  category: string;
  category_name: string;
  amount: string;
  payee: string | null;
  note: string | null;
  business_date_ad: string;
  business_date_bs: string;
  fiscal_year_bs: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface ExpensePayload {
  category: string;
  amount: string;
  business_date_ad: string;
  payee?: string;
  note?: string;
}

export interface ExpenseSummaryGroup {
  key: string;
  count: number;
  total: string;
}

export interface ExpenseSummary {
  date_from_bs: string;
  date_to_bs: string;
  group_by: 'category' | 'month';
  groups: ExpenseSummaryGroup[];
  total: string;
}

export interface ExpenseListFilters {
  category?: string;
  dateFromBs: string;
  dateToBs: string;
  page?: number;
}

export function listCategories(): Promise<Page<ExpenseCategory>> {
  return authedRequestPage<ExpenseCategory>('/v1/expenses/categories?is_active=true&limit=200');
}

export function listExpenses(filters: ExpenseListFilters): Promise<Page<Expense>> {
  const params = new URLSearchParams({
    date_from_bs: filters.dateFromBs,
    date_to_bs: filters.dateToBs,
    limit: '25',
    page: String(filters.page ?? 1),
  });
  if (filters.category) {
    params.set('category', filters.category);
  }
  return authedRequestPage<Expense>(`/v1/expenses?${params}`);
}

export function fetchExpenseSummary(dateFromBs: string, dateToBs: string): Promise<ExpenseSummary> {
  const params = new URLSearchParams({
    date_from_bs: dateFromBs,
    date_to_bs: dateToBs,
    group_by: 'category',
  });
  return authedRequest<ExpenseSummary>(`/v1/expenses/summary?${params}`);
}

export function createExpense(payload: ExpensePayload): Promise<Expense> {
  return authedRequest<Expense>('/v1/expenses', { method: 'POST', body: payload });
}

export function createCategory(name: string): Promise<ExpenseCategory> {
  return authedRequest<ExpenseCategory>('/v1/expenses/categories', {
    method: 'POST',
    body: { name },
  });
}
