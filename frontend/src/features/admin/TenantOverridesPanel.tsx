import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { deleteOverride, listOverrides, setOverride } from '@/features/admin/api';
import { AdminCard, EmptyState, Field, LoadingRows } from '@/features/admin/components';
import { KNOWN_LIMITS } from '@/features/admin/PlansPage.parts';
import { ApiError } from '@/lib/api/client';
import { PLAN_FEATURE_CATALOG } from '@/lib/plans';

const CUSTOM_KEY = '__custom__';

const selectClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Human-readable value cell: booleans become pills, anything else mono JSON. */
function OverrideValue({ value }: { value: unknown }) {
  if (value === true) return <Badge variant="success">On</Badge>;
  if (value === false) return <Badge variant="secondary">Off</Badge>;
  return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
}

export function TenantOverridesPanel({
  tenantId,
  canWrite,
}: {
  tenantId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
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
    <AdminCard
      title="Feature & limit overrides"
      description="Per-shop exceptions to the plan. An unexpired override wins over the plan default."
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add override
          </Button>
        ) : null
      }
    >
      {overrides.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {overrides.error instanceof Error ? overrides.error.message : 'Could not load overrides.'}
        </p>
      ) : null}
      {remove.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {remove.error instanceof ApiError ? remove.error.message : 'Could not remove override.'}
        </p>
      ) : null}
      {overrides.data?.data.length === 0 ? (
        <EmptyState title="No overrides" body="This shop runs exactly on its plan defaults." />
      ) : null}
      {overrides.data?.data.length || overrides.isPending ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Note</TableHead>
              {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.isPending ? <LoadingRows columns={canWrite ? 5 : 4} /> : null}
            {overrides.data?.data.map((override) => (
              <TableRow key={override.id}>
                <TableCell className="font-mono text-xs">{override.key}</TableCell>
                <TableCell>
                  <OverrideValue value={override.value} />
                </TableCell>
                <TableCell>
                  {override.expires_at ? new Date(override.expires_at).toLocaleString() : 'Never'}
                </TableCell>
                <TableCell>{override.note ?? '—'}</TableCell>
                {canWrite ? (
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove override ${override.key}? The plan default applies again.`,
                          )
                        ) {
                          remove.mutate(override.id);
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add override</DialogTitle>
            <DialogDescription>
              Override one plan value for this shop, optionally with an expiry. The change is
              audited.
            </DialogDescription>
          </DialogHeader>
          {adding ? <OverrideForm tenantId={tenantId} onDone={() => setAdding(false)} /> : null}
        </DialogContent>
      </Dialog>
    </AdminCard>
  );
}

function OverrideForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [picker, setPicker] = useState(`features.${PLAN_FEATURE_CATALOG[0].key}`);
  const [customKey, setCustomKey] = useState('');
  const [boolValue, setBoolValue] = useState(true);
  const [jsonValue, setJsonValue] = useState('true');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const isFeatureKey = picker.startsWith('features.') && picker !== CUSTOM_KEY;
  const mutation = useMutation({
    mutationFn: () =>
      setOverride(tenantId, {
        key: picker === CUSTOM_KEY ? customKey.trim() : picker,
        value: isFeatureKey ? boolValue : (JSON.parse(jsonValue) as unknown),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        note: note.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['platform', 'tenants', tenantId, 'overrides'],
      });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (picker === CUSTOM_KEY && !customKey.trim()) {
      setFormError('Enter the override key, e.g. limits.max_users.');
      return;
    }
    if (!isFeatureKey) {
      try {
        JSON.parse(jsonValue);
      } catch {
        setFormError('Value must be valid JSON, e.g. true, 10, or "text".');
        return;
      }
    }
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field label="Setting" htmlFor="override-key">
        <select
          id="override-key"
          value={picker}
          onChange={(event) => setPicker(event.target.value)}
          className={selectClass}
        >
          <optgroup label="Features">
            {PLAN_FEATURE_CATALOG.map((feature) => (
              <option key={feature.key} value={`features.${feature.key}`}>
                {feature.label} (features.{feature.key})
              </option>
            ))}
          </optgroup>
          <optgroup label="Limits">
            {KNOWN_LIMITS.map((limit) => (
              <option key={limit.key} value={`limits.${limit.key}`}>
                {limit.label} (limits.{limit.key})
              </option>
            ))}
          </optgroup>
          <option value={CUSTOM_KEY}>Custom key…</option>
        </select>
      </Field>
      {picker === CUSTOM_KEY ? (
        <Input
          label="Custom key"
          placeholder="limits.max_users"
          value={customKey}
          onChange={(event) => setCustomKey(event.target.value)}
          className="font-mono text-xs"
        />
      ) : null}
      {isFeatureKey ? (
        <div className="flex items-center gap-2">
          <Switch id="override-value" checked={boolValue} onCheckedChange={setBoolValue} />
          <label htmlFor="override-value" className="text-sm font-medium">
            {boolValue ? 'On' : 'Off'} for this shop
          </label>
        </div>
      ) : (
        <Input
          label="Value (JSON)"
          required
          value={jsonValue}
          onChange={(event) => setJsonValue(event.target.value)}
          className="font-mono text-xs"
        />
      )}
      <Input
        label="Expires at (optional)"
        type="datetime-local"
        value={expiresAt}
        onChange={(event) => setExpiresAt(event.target.value)}
      />
      <Input
        label="Reason / note (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      {formError || mutation.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError ??
            (mutation.error instanceof ApiError
              ? mutation.error.message
              : 'Could not save override.')}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Set override'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
