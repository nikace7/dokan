import { useState } from 'react';
import { Eye, PencilLine, ShieldCheck } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { AdminCard, Field } from '@/features/admin/components';
import {
  endImpersonation,
  listImpersonationTargets,
  startImpersonation,
} from '@/features/admin/api';
import type { ImpersonationSession, PlatformRole } from '@/features/admin/api';
import { buildSupportHandoffUrl } from '@/features/admin/supportHandoff';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Scope = 'READ_ONLY' | 'READ_WRITE';

const MIN_REASON_LENGTH = 20;
const DURATION_OPTIONS = [5, 15, 30, 60] as const;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.code ? `${error.message} (${error.code})` : error.message;
  }
  return fallback;
}

function ScopeCard({
  value,
  title,
  body,
  icon: Icon,
  selected,
  disabled,
  disabledHint,
  onSelect,
}: {
  value: Scope;
  title: string;
  body: string;
  icon: typeof Eye;
  selected: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onSelect: (scope: Scope) => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
        selected ? 'border-primary bg-accent shadow-sm' : 'hover:bg-muted/60',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
      )}
    >
      <input
        type="radio"
        name="assist-scope"
        className="mt-1 accent-primary"
        value={value}
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect(value)}
      />
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
          selected ? 'bg-tint-green text-tint-green-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-sm text-muted-foreground">{body}</span>
        {disabled && disabledHint ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{disabledHint}</span>
        ) : null}
      </span>
    </label>
  );
}

const selectClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

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
  const [scope, setScope] = useState<Scope>('READ_ONLY');
  const [duration, setDuration] = useState(15);
  const [session, setSession] = useState<ImpersonationSession | null>(null);
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
    onSuccess: ({ session: started, access }) => {
      setSession(started);
      setHandoffUrl(buildSupportHandoffUrl(slug, access));
    },
  });
  const end = useMutation({
    mutationFn: (sessionId: string) => endImpersonation(sessionId),
    onSuccess: () => {
      setSession(null);
      setHandoffUrl(null);
    },
  });

  const trimmedReason = reason.trim();
  const reasonTooShort = trimmedReason.length > 0 && trimmedReason.length < MIN_REASON_LENGTH;
  const canSubmit =
    !start.isPending && targetUser !== '' && trimmedReason.length >= MIN_REASON_LENGTH;
  const targetName = targets.data?.find((target) => target.id === session?.target_user_id);

  return (
    <AdminCard
      title="Assist this shop"
      description="Start a time-boxed, audited session inside the shop. The owner is notified by SMS and can end the session anytime."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Target user" htmlFor="assist-target">
          <select
            id="assist-target"
            value={targetUser}
            disabled={targets.isPending}
            onChange={(event) => setTargetUser(event.target.value)}
            className={selectClass}
          >
            <option value="">
              {targets.isPending ? 'Loading users…' : 'Select an active tenant user'}
            </option>
            {targets.data?.map((target) => (
              <option key={target.id} value={target.id}>
                {target.full_name} · {target.phone}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration" htmlFor="assist-duration">
          <select
            id="assist-duration"
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            className={selectClass}
          >
            {DURATION_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-foreground">Scope</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <ScopeCard
              value="READ_ONLY"
              title="View only"
              body="Look around without changing anything."
              icon={Eye}
              selected={scope === 'READ_ONLY'}
              onSelect={setScope}
            />
            <ScopeCard
              value="READ_WRITE"
              title="Assist — can edit"
              body="Fix catalog, stock, sales and settings on their behalf."
              icon={PencilLine}
              selected={scope === 'READ_WRITE'}
              disabled={role !== 'SUPER_ADMIN'}
              disabledHint="Super admins only."
              onSelect={setScope}
            />
          </div>
        </fieldset>
        <Field
          label="Reason"
          htmlFor="assist-reason"
          className="sm:col-span-2"
          error={reasonTooShort ? `Reason must be at least ${MIN_REASON_LENGTH} characters.` : undefined}
          hint="The shop owner sees this reason. It is stored in the audit log (min 20 characters)."
        >
          <textarea
            id="assist-reason"
            value={reason}
            maxLength={1000}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            className={cn(selectClass, 'resize-y')}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Always blocked, even in Assist mode: password changes, staff &amp; user management, plan
          &amp; billing changes, and tenant deletion.
        </p>
      </div>

      {targets.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {errorMessage(targets.error, 'Could not load tenant users.')}
        </p>
      ) : null}
      {start.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {errorMessage(start.error, 'Could not start support access.')}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={!canSubmit} onClick={() => start.mutate()}>
          {start.isPending ? 'Starting…' : 'Start assist session'}
        </Button>
      </div>

      {session ? (
        <div className="mt-4 rounded-lg border border-primary/40 bg-accent p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium text-accent-foreground">
                Session active
                {targetName ? ` — ${targetName.full_name}` : ''} ·{' '}
                {session.scope === 'READ_WRITE' ? 'Assist — can edit' : 'View only'}
              </p>
              <p className="text-muted-foreground">
                Expires {new Date(session.expires_at).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {handoffUrl ? (
                <Button variant="danger" size="sm" asChild>
                  <a href={handoffUrl} target="_blank" rel="noopener noreferrer">
                    Open audited tenant session
                  </a>
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={end.isPending}
                onClick={() => end.mutate(session.id)}
              >
                {end.isPending ? 'Ending…' : 'End now'}
              </Button>
            </div>
          </div>
          {end.isError ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {errorMessage(end.error, 'Could not end the session.')}
            </p>
          ) : null}
        </div>
      ) : null}
    </AdminCard>
  );
}
