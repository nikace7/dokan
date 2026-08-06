import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { createRateType, deactivateRateType, updateRateType } from '@/features/pricing/api';
import type { RateTypePayload } from '@/features/pricing/api';
import { selectClasses } from '@/features/pricing/ui';
import { listPermissions } from '@/features/settings/api';
import type { RateType } from '@/features/settings/api';
import { ApiError } from '@/lib/api/client';

export function RateTypesPanel({ rates, canEdit }: { rates: RateType[]; canEdit: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RateType | 'new' | null>(null);
  const deactivate = useMutation({
    mutationFn: deactivateRateType,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pricing', 'rate-types'] }),
  });

  return (
    <Card
      title={t('pricing.rateTypes.title')}
      actions={
        canEdit ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            {t('pricing.rateTypes.new')}
          </Button>
        ) : null
      }
    >
      {editing && canEdit ? (
        <RateTypeForm
          rate={editing === 'new' ? undefined : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {rates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('pricing.rateTypes.empty')}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rates.map((rate) => (
          <section key={rate.id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">
                  {rate.name}
                  {rate.name_np ? (
                    <span className="ml-1 text-muted-foreground">{rate.name_np}</span>
                  ) : null}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {rate.code}
                  {rate.is_default ? ` · ${t('pricing.rateTypes.default')}` : ''}
                  {!rate.is_active ? ` · ${t('pricing.rateTypes.inactive')}` : ''}
                </p>
              </div>
              {canEdit ? (
                <Button size="sm" variant="secondary" onClick={() => setEditing(rate)}>
                  {t('pricing.rateTypes.edit')}
                </Button>
              ) : null}
            </div>
            <dl className="mt-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <dt>{t('pricing.rateTypes.defaultMargin')}</dt>
                <dd>{rate.default_margin_pct ? `${rate.default_margin_pct}%` : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('pricing.rateTypes.requiredPermission')}</dt>
                <dd>{rate.required_permission ?? t('pricing.rateTypes.none')}</dd>
              </div>
            </dl>
            {canEdit && rate.is_active && !rate.is_default ? (
              <button
                type="button"
                className="mt-3 text-xs text-destructive underline disabled:text-muted-foreground"
                disabled={deactivate.isPending}
                onClick={() => deactivate.mutate(rate.id)}
              >
                {t('pricing.rateTypes.deactivate')}
              </button>
            ) : null}
          </section>
        ))}
      </div>
      {deactivate.isError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {deactivate.error instanceof ApiError
            ? deactivate.error.message
            : t('pricing.rateTypes.deactivateError')}
        </p>
      ) : null}
    </Card>
  );
}

function initial(rate?: RateType): RateTypePayload {
  return rate
    ? {
        code: rate.code,
        name: rate.name,
        name_np: rate.name_np,
        is_default: rate.is_default,
        sort_order: rate.sort_order,
        default_margin_pct: rate.default_margin_pct,
        required_permission: rate.required_permission,
      }
    : {
        code: '',
        name: '',
        name_np: null,
        is_default: false,
        sort_order: 0,
        default_margin_pct: null,
        required_permission: null,
      };
}

function RateTypeForm({ rate, onDone }: { rate?: RateType; onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const permissions = useQuery({
    queryKey: ['permissions'],
    queryFn: listPermissions,
    staleTime: 5 * 60_000,
  });
  const [form, setForm] = useState(() => initial(rate));
  const mutation = useMutation({
    mutationFn: (payload: RateTypePayload) =>
      rate ? updateRateType(rate.id, payload) : createRateType(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pricing', 'rate-types'] });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({
      ...form,
      code: form.code.trim().toLowerCase(),
      name: form.name.trim(),
      name_np: form.name_np?.trim() || null,
      default_margin_pct: form.default_margin_pct || null,
      required_permission: form.required_permission || null,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mb-4 grid gap-3 rounded-md border border-primary/40 bg-primary/5 p-3 sm:grid-cols-2"
    >
      <Input
        label={t('pricing.rateTypes.rateCode')}
        required
        value={form.code}
        onChange={(event) => setForm({ ...form, code: event.target.value })}
      />
      <Input
        label={t('pricing.rateTypes.rateName')}
        required
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />
      <Input
        label={t('pricing.rateTypes.rateNameNp')}
        value={form.name_np ?? ''}
        onChange={(event) => setForm({ ...form, name_np: event.target.value })}
      />
      <Input
        label={t('pricing.rateTypes.defaultMarginPct')}
        inputMode="decimal"
        value={form.default_margin_pct ?? ''}
        onChange={(event) => setForm({ ...form, default_margin_pct: event.target.value })}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rate-required-permission">
          {t('pricing.rateTypes.requiredPermission')}
        </Label>
        <select
          id="rate-required-permission"
          value={form.required_permission ?? ''}
          onChange={(event) =>
            setForm({ ...form, required_permission: event.target.value || null })
          }
          className={selectClasses}
        >
          <option value="">{t('pricing.rateTypes.anyoneBilling')}</option>
          {permissions.data?.map((permission) => (
            <option key={permission.code} value={permission.code}>
              {permission.code} — {permission.name}
            </option>
          ))}
        </select>
      </div>
      <Input
        label={t('pricing.rateTypes.sortOrder')}
        type="number"
        value={form.sort_order}
        onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) })}
      />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={form.is_default}
          onChange={(event) => setForm({ ...form, is_default: event.target.checked })}
          className="h-4 w-4 accent-primary"
        />
        {t('pricing.rateTypes.makeDefault')}
      </label>
      {mutation.isError ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : t('pricing.rateTypes.saveError')}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={mutation.isPending}>
          {t('pricing.rateTypes.save')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
