import { authedRequest } from '@/lib/api/authed';

export interface SupportSession {
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
  ended_by: string | null;
}

export function getCurrentSupportSession(): Promise<SupportSession> {
  return authedRequest<SupportSession>('/v1/support-access/current');
}

export function listSupportSessions(): Promise<SupportSession[]> {
  return authedRequest<SupportSession[]>('/v1/support-access');
}

export function endSupportSession(id: string): Promise<SupportSession> {
  return authedRequest<SupportSession>(`/v1/support-access/${id}/end`, { method: 'POST' });
}
