import { useMutation, useQuery } from '@tanstack/react-query';

import { endSupportSession, getCurrentSupportSession } from '@/features/support/api';
import { getImpersonationClaims } from '@/lib/auth/tokens';

export function SupportAccessBanner({ onEnded }: { onEnded: () => void }) {
  const claims = getImpersonationClaims();
  const query = useQuery({
    queryKey: ['support-access', 'current', claims?.jti],
    queryFn: getCurrentSupportSession,
    enabled: claims !== null,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: () => endSupportSession(claims?.jti ?? ''),
    onSuccess: onEnded,
  });

  if (!claims) return null;
  const name = query.data?.platform_user_name ?? claims.act;
  const expires = query.data?.expires_at ?? new Date(claims.exp * 1000).toISOString();

  return (
    <aside role="alert" className="sticky top-0 z-50 bg-red-700 px-4 py-2 text-white shadow">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 text-sm">
        <strong>Support session active</strong>
        <span>
          {name} · {claims.scope === 'read_only' ? 'Read only' : 'Read/write'} · ends{' '}
          {new Date(expires).toLocaleTimeString('en-NP', {
            timeZone: 'Asia/Kathmandu',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <button
          type="button"
          className="ml-auto rounded bg-white px-3 py-1 font-medium text-red-700 disabled:opacity-60"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          aria-label="End support session"
        >
          {mutation.isPending ? 'Ending…' : 'End now'}
        </button>
        {mutation.isError ? <span>Could not end the session. Try again.</span> : null}
      </div>
    </aside>
  );
}
