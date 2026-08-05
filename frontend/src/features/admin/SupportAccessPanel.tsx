import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { listImpersonationTargets, startImpersonation } from '@/features/admin/api';
import type { PlatformRole } from '@/features/admin/api';
import { buildSupportHandoffUrl } from '@/features/admin/supportHandoff';
import { ApiError } from '@/lib/api/client';

export function SupportAccessPanel({
  tenantId,
  slug,
  role,
}: {
  tenantId: string;
  slug: string;
  role: PlatformRole;
}) {
  const [targetUser, setTargetUser] = useState('');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<'READ_ONLY' | 'READ_WRITE'>('READ_ONLY');
  const [duration, setDuration] = useState(15);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const targets = useQuery({
    queryKey: ['platform', 'tenants', tenantId, 'impersonation-targets'],
    queryFn: () => listImpersonationTargets(tenantId),
  });
  const start = useMutation({
    mutationFn: () =>
      startImpersonation(tenantId, {
        target_user: targetUser,
        reason: reason.trim(),
        scope,
        duration_minutes: duration,
      }),
    onSuccess: ({ access }) => setHandoffUrl(buildSupportHandoffUrl(slug, access)),
  });

  return (
    <Card title="Support access">
      <p className="mb-3 text-sm text-slate-600">
        This creates a time-boxed, audited tenant session and notifies the shop owner.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Target user
          <select
            value={targetUser}
            onChange={(event) => setTargetUser(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
          >
            <option value="">Select an active tenant user</option>
            {targets.data?.map((target) => (
              <option key={target.id} value={target.id}>
                {target.full_name} · {target.phone}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Duration
          <select
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Scope
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as 'READ_ONLY' | 'READ_WRITE')}
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
          >
            <option value="READ_ONLY">Read only</option>
            {role === 'SUPER_ADMIN' ? <option value="READ_WRITE">Read/write</option> : null}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
          <label htmlFor="support-access-reason">Reason</label>
          <textarea
            id="support-access-reason"
            value={reason}
            minLength={20}
            maxLength={1000}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
          />
          <span className="text-xs text-slate-500">
            At least 20 characters; stored in the audit log.
          </span>
        </div>
      </div>
      {start.isError ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {start.error instanceof ApiError
            ? start.error.message
            : 'Could not start support access.'}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          disabled={start.isPending || !targetUser || reason.trim().length < 20}
          onClick={() => {
            setHandoffUrl(null);
            start.mutate();
          }}
        >
          {start.isPending ? 'Starting…' : 'Start support access'}
        </Button>
        {handoffUrl ? (
          <a
            href={handoffUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white"
          >
            Open audited tenant session
          </a>
        ) : null}
      </div>
    </Card>
  );
}
