import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { deleteOverride, listOverrides, setOverride } from '@/features/admin/api';
import { ApiError } from '@/lib/api/client';

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export function TenantOverridesPanel({
  tenantId,
  canWrite,
}: {
  tenantId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const overrides = useQuery({
    queryKey: ['platform', 'tenants', tenantId, 'overrides'],
    queryFn: () => listOverrides(tenantId),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteOverride(tenantId, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['platform', 'tenants', tenantId, 'overrides'] }),
  });

  return (
    <Card title="Feature and limit overrides">
      {canWrite ? <OverrideForm tenantId={tenantId} /> : null}
      {overrides.data?.data.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">No overrides.</p>
      ) : null}
      {overrides.data?.data.length ? (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500">
              <th className="py-2">Key</th>
              <th className="py-2">Value</th>
              <th className="py-2">Expires</th>
              <th className="py-2">Note</th>
              {canWrite ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {overrides.data.data.map((override) => (
              <tr key={override.id} className="border-b border-slate-100">
                <td className="py-2 font-mono text-xs">{override.key}</td>
                <td className="py-2 font-mono text-xs">{JSON.stringify(override.value)}</td>
                <td className="py-2">
                  {override.expires_at ? new Date(override.expires_at).toLocaleString() : 'Never'}
                </td>
                <td className="py-2">{override.note ?? '—'}</td>
                {canWrite ? (
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(override.id)}
                    >
                      Remove
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  );
}

function OverrideForm({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('true');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      setOverride(tenantId, {
        key: key.trim(),
        value: parseJson(value),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['platform', 'tenants', tenantId, 'overrides'],
      });
      setKey('');
      setValue('true');
      setExpiresAt('');
      setNote('');
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
      <Input
        label="Override key"
        placeholder="limits.max_users"
        required
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <Input
        label="JSON value"
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Input
        label="Expires at"
        type="datetime-local"
        value={expiresAt}
        onChange={(event) => setExpiresAt(event.target.value)}
      />
      <Input label="Reason / note" value={note} onChange={(event) => setNote(event.target.value)} />
      {mutation.isError ? (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Could not save override.'}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          Set override
        </Button>
      </div>
    </form>
  );
}
