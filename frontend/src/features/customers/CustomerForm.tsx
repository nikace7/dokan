import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { createCustomer, updateCustomer } from '@/features/customers/api';
import type { Customer, CustomerPayload } from '@/features/customers/api';
import { ApiError } from '@/lib/api/client';

export const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

function initial(customer?: Customer): CustomerPayload {
  return {
    name: customer?.name ?? '',
    phone: customer?.phone ?? null,
    address: customer?.address ?? null,
    default_rate_type: customer?.default_rate_type ?? null,
    credit_limit: customer?.credit_limit ?? null,
    opening_balance: customer?.opening_balance ?? '0.00',
    birthday_bs: customer?.birthday_bs ?? null,
    gender: customer?.gender ?? null,
    note: customer?.note ?? null,
  };
}

export function CustomerForm({
  customer,
  canSetCredit,
  rates,
  onDone,
}: {
  customer?: Customer;
  canSetCredit: boolean;
  rates: Array<{ id: string; name: string }>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => initial(customer));
  const save = useMutation({
    mutationFn: (payload: CustomerPayload) =>
      customer ? updateCustomer(customer.id, payload) : createCustomer(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const payload: CustomerPayload = {
      ...form,
      name: form.name.trim(),
      phone: form.phone?.trim() || null,
      address: form.address?.trim() || null,
      birthday_bs: form.birthday_bs?.trim() || null,
      note: form.note?.trim() || null,
    };
    if (!canSetCredit) delete payload.credit_limit;
    save.mutate(payload);
  };

  return (
    <form
      onSubmit={submit}
      className="mb-5 grid gap-3 rounded-md border border-border bg-muted/50 p-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <Input
        label={t('customers.form.name')}
        required
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />
      <Input
        label={t('customers.form.phone')}
        value={form.phone ?? ''}
        onChange={(event) => setForm({ ...form, phone: event.target.value })}
      />
      <Input
        label={t('customers.form.address')}
        value={form.address ?? ''}
        onChange={(event) => setForm({ ...form, address: event.target.value })}
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t('customers.form.defaultRate')}
        <select
          value={form.default_rate_type ?? ''}
          onChange={(event) => setForm({ ...form, default_rate_type: event.target.value || null })}
          className={`${selectClasses} font-normal`}
        >
          <option value="">{t('customers.form.shopDefault')}</option>
          {rates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {rate.name}
            </option>
          ))}
        </select>
      </label>
      {canSetCredit ? (
        <Input
          label={t('customers.form.creditLimit')}
          inputMode="decimal"
          value={form.credit_limit ?? ''}
          onChange={(event) => setForm({ ...form, credit_limit: event.target.value || null })}
          placeholder={t('customers.form.creditUnlimited')}
        />
      ) : null}
      <Input
        label={t('customers.form.openingBalance')}
        inputMode="decimal"
        value={form.opening_balance ?? '0.00'}
        onChange={(event) => setForm({ ...form, opening_balance: event.target.value })}
      />
      <Input
        label={t('customers.form.birthdayBs')}
        value={form.birthday_bs ?? ''}
        onChange={(event) => setForm({ ...form, birthday_bs: event.target.value })}
        placeholder="2082-04-12"
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t('customers.form.gender')}
        <select
          value={form.gender ?? ''}
          onChange={(event) => setForm({ ...form, gender: event.target.value || null })}
          className={`${selectClasses} font-normal`}
        >
          <option value="">{t('customers.form.genderUnspecified')}</option>
          <option value="F">{t('customers.form.genderFemale')}</option>
          <option value="M">{t('customers.form.genderMale')}</option>
          <option value="OTHER">{t('customers.form.genderOther')}</option>
        </select>
      </label>
      <Input
        label={t('common.note')}
        value={form.note ?? ''}
        onChange={(event) => setForm({ ...form, note: event.target.value })}
      />
      {save.isError ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2 lg:col-span-3"
        >
          {save.error instanceof ApiError ? save.error.message : t('customers.form.saveError')}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={save.isPending}>
          {t('customers.form.save')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
