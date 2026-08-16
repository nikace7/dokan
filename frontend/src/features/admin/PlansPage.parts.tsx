/**
 * Plan create/edit form (Slice C). Friendly editors for the known limit and
 * feature keys serialize back into the `limits`/`features` JSON payload;
 * custom rows round-trip any keys the form does not know about.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/switch';
import { createPlan, updatePlan } from '@/features/admin/api';
import type { Plan, PlanPayload } from '@/features/admin/api';
import { Field } from '@/features/admin/components';
import { ApiError } from '@/lib/api/client';
import { PLAN_FEATURE_CATALOG } from '@/lib/plans';

/** Known numeric limit keys, shown as labeled inputs instead of raw JSON. */
export const KNOWN_LIMITS = [
  { key: 'max_users', label: 'Staff accounts' },
  { key: 'max_branches', label: 'Branches' },
  { key: 'max_items', label: 'Catalog items' },
  { key: 'max_invoices_per_month', label: 'Invoices per month' },
  { key: 'sms_credits_per_month', label: 'SMS credits per month' },
] as const;

const KNOWN_LIMIT_KEYS = new Set<string>(KNOWN_LIMITS.map((limit) => limit.key));
const KNOWN_FEATURE_KEYS = new Set<string>([
  ...PLAN_FEATURE_CATALOG.map((feature) => feature.key),
  'max_rate_types',
]);

interface ExtraRow {
  key: string;
  value: string;
}

function toExtraRows(values: Record<string, unknown>, known: Set<string>): ExtraRow[] {
  return Object.entries(values)
    .filter(([key]) => !known.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value: JSON.stringify(value) ?? '' }));
}

const selectClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function defaultLimits(): Record<string, string> {
  return Object.fromEntries(KNOWN_LIMITS.map((limit) => [limit.key, '']));
}

export function PlanForm({ plan, onDone }: { plan?: Plan; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [price, setPrice] = useState(plan?.price_npr ?? '0.00');
  const [cycle, setCycle] = useState<PlanPayload['billing_cycle']>(plan?.billing_cycle ?? 'monthly');
  const [sortOrder, setSortOrder] = useState(String(plan?.sort_order ?? 0));
  const [isActive, setIsActive] = useState(plan?.is_active ?? true);
  const [limits, setLimits] = useState<Record<string, string>>(() => {
    const values = defaultLimits();
    for (const limit of KNOWN_LIMITS) {
      const raw = plan?.limits[limit.key];
      if (typeof raw === 'number') values[limit.key] = String(raw);
    }
    return values;
  });
  const [flags, setFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      PLAN_FEATURE_CATALOG.map((feature) => [feature.key, plan?.features[feature.key] === true]),
    ),
  );
  const [maxRateTypes, setMaxRateTypes] = useState(
    typeof plan?.features.max_rate_types === 'number' ? String(plan.features.max_rate_types) : '',
  );
  const [extraLimits, setExtraLimits] = useState<ExtraRow[]>(() =>
    toExtraRows(plan?.limits ?? {}, KNOWN_LIMIT_KEYS),
  );
  const [extraFeatures, setExtraFeatures] = useState<ExtraRow[]>(() =>
    toExtraRows(plan?.features ?? {}, KNOWN_FEATURE_KEYS),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: PlanPayload) =>
      plan ? updatePlan(plan.id, payload) : createPlan(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
      onDone();
    },
  });

  const updateRow = (
    rows: ExtraRow[],
    setRows: (rows: ExtraRow[]) => void,
    index: number,
    patch: Partial<ExtraRow>,
  ) => setRows(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  const buildJson = (
    extras: ExtraRow[],
    known: Record<string, unknown>,
  ): Record<string, unknown> | null => {
    const out: Record<string, unknown> = {};
    for (const row of extras) {
      const key = row.key.trim();
      if (!key) {
        if (row.value.trim()) return null;
        continue;
      }
      try {
        out[key] = JSON.parse(row.value) as unknown;
      } catch {
        return null;
      }
    }
    return { ...out, ...known };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const knownLimits: Record<string, unknown> = {};
    for (const limit of KNOWN_LIMITS) {
      const raw = (limits[limit.key] ?? '').trim();
      if (raw) knownLimits[limit.key] = Number(raw);
    }
    const knownFeatures: Record<string, unknown> = Object.fromEntries(
      PLAN_FEATURE_CATALOG.map((feature) => [feature.key, flags[feature.key] === true]),
    );
    if (maxRateTypes.trim()) knownFeatures.max_rate_types = Number(maxRateTypes.trim());
    const parsedLimits = buildJson(extraLimits, knownLimits);
    const parsedFeatures = buildJson(extraFeatures, knownFeatures);
    if (!parsedLimits || !parsedFeatures) {
      setFormError('Custom rows need a key and a valid JSON value (e.g. true, 10, or "text").');
      return;
    }
    mutation.mutate({
      code: code.trim().toLowerCase(),
      name: name.trim(),
      price_npr: price.trim(),
      billing_cycle: cycle,
      limits: parsedLimits,
      features: parsedFeatures,
      is_active: isActive,
      sort_order: Number(sortOrder) || 0,
    });
  };

  const extraEditor = (
    rows: ExtraRow[],
    setRows: (rows: ExtraRow[]) => void,
    addLabel: string,
  ) => (
    <div className="space-y-2 sm:col-span-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label="Custom key"
            placeholder="key_name"
            value={row.key}
            onChange={(event) => updateRow(rows, setRows, index, { key: event.target.value })}
            className="font-mono text-xs"
          />
          <Input
            aria-label="Custom value (JSON)"
            placeholder='true, 10, or "text"'
            value={row.value}
            onChange={(event) => updateRow(rows, setRows, index, { value: event.target.value })}
            className="font-mono text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove row"
            onClick={() => setRows(rows.filter((_row, rowIndex) => rowIndex !== index))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setRows([...rows, { key: '', value: '' }])}
      >
        <Plus /> {addLabel}
      </Button>
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Input
        label="Code"
        required
        disabled={Boolean(plan)}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
      <Input label="Name" required value={name} onChange={(event) => setName(event.target.value)} />
      <Input
        label="Price (NPR)"
        required
        inputMode="decimal"
        value={price}
        onChange={(event) => setPrice(event.target.value)}
      />
      <Field label="Billing cycle" htmlFor="plan-cycle">
        <select
          id="plan-cycle"
          value={cycle}
          onChange={(event) => setCycle(event.target.value as PlanPayload['billing_cycle'])}
          className={selectClass}
        >
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </Field>
      <Input
        label="Sort order"
        type="number"
        value={sortOrder}
        onChange={(event) => setSortOrder(event.target.value)}
      />
      <div className="flex items-center gap-2 self-end pb-2">
        <Switch id="plan-active" checked={isActive} onCheckedChange={setIsActive} />
        <label htmlFor="plan-active" className="text-sm font-medium">
          Active — shops can be put on this plan
        </label>
      </div>

      <h3 className="mt-2 text-sm font-semibold text-foreground sm:col-span-2">Limits</h3>
      {KNOWN_LIMITS.map((limit) => (
        <Input
          key={limit.key}
          label={limit.label}
          type="number"
          min={0}
          placeholder="Unlimited"
          value={limits[limit.key] ?? ''}
          onChange={(event) => setLimits({ ...limits, [limit.key]: event.target.value })}
        />
      ))}
      {extraEditor(extraLimits, setExtraLimits, 'Add custom limit')}

      <h3 className="mt-2 text-sm font-semibold text-foreground sm:col-span-2">Features</h3>
      <ul className="divide-y divide-border sm:col-span-2">
        {PLAN_FEATURE_CATALOG.map((feature) => (
          <li key={feature.key} className="flex items-center justify-between gap-4 py-2">
            <div>
              <p className="text-sm font-medium">{feature.label}</p>
              <p className="text-xs text-muted-foreground">{feature.description}</p>
            </div>
            <Switch
              aria-label={feature.label}
              checked={flags[feature.key] === true}
              onCheckedChange={(checked) => setFlags({ ...flags, [feature.key]: checked })}
            />
          </li>
        ))}
      </ul>
      <Input
        label="Max custom rate types"
        type="number"
        min={0}
        placeholder="No extra rate types"
        value={maxRateTypes}
        onChange={(event) => setMaxRateTypes(event.target.value)}
        className="sm:col-span-2"
      />
      {extraEditor(extraFeatures, setExtraFeatures, 'Add custom feature')}

      {formError || mutation.isError ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {formError ??
            (mutation.error instanceof ApiError ? mutation.error.message : 'Could not save plan.')}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : plan ? 'Save plan' : 'Create plan'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
