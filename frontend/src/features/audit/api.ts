import { authedRequestPage } from '@/lib/api/authed';
import type { Page } from '@/lib/api/client';

export interface AuditLog {
  id: string;
  actor: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  impersonated_by: string | null;
  ip: string | null;
  created_at: string;
}

export interface AuditFilters {
  action?: string;
  targetType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
}

export function listAuditLogs(filters: AuditFilters = {}): Promise<Page<AuditLog>> {
  const params = new URLSearchParams({ limit: '20', page: String(filters.page ?? 1) });
  if (filters.action) params.set('action', filters.action);
  if (filters.targetType) params.set('target_type', filters.targetType);
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);
  return authedRequestPage<AuditLog>(`/v1/audit/?${params}`);
}
