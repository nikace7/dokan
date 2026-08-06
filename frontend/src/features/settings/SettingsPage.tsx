import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { getTenantSettings, updateTenantSettings } from '@/features/settings/api';
import type { TenantSettings } from '@/features/settings/api';
import { useAuth } from '@/features/auth/useAuth';
import { ApiError } from '@/lib/api/client';
import { hasPermission } from '@/lib/permissions';

type SettingsForm = {
  name: string;
  name_np: string;
  legal_name: string;
  pan_vat_no: string;
  vat_registered: boolean;
  calendar_pref: TenantSettings['calendar_pref'];
  locale: TenantSettings['locale'];
};

function toForm(settings: TenantSettings): SettingsForm {
  return {
    name: settings.name,
    name_np: settings.name_np ?? '',
    legal_name: settings.legal_name ?? '',
    pan_vat_no: settings.pan_vat_no ?? '',
    vat_registered: settings.vat_registered,
    calendar_pref: settings.calendar_pref,
    locale: settings.locale,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Could not save shop settings.';
}

const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** Owner-facing tenant profile and presentation settings. */
export function SettingsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, 'settings.manage');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['tenant', 'settings'],
    queryFn: getTenantSettings,
    enabled: canManage,
    retry: false,
  });
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setForm(toForm(query.data));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: updateTenantSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(['tenant', 'settings'], settings);
      setForm(toForm(settings));
      setFormError(null);
      setStatusMessage('Shop settings saved.');
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  if (!canManage) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <Card title="Settings / सेटिङ">
          <p className="text-sm text-muted-foreground">Only the shop owner can manage settings.</p>
        </Card>
      </main>
    );
  }

  if (query.isPending) {
    return (
      <main className="mx-auto max-w-3xl p-4 text-sm text-muted-foreground">
        Loading shop settings…
      </main>
    );
  }

  if (query.isError || !query.data || !form) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage(query.error)}
        </p>
      </main>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentForm = form;
    if (!currentForm) return;
    if (!currentForm.name.trim()) {
      setFormError('Shop name is required.');
      return;
    }
    setStatusMessage(null);
    setFormError(null);
    mutation.mutate({
      ...currentForm,
      name: currentForm.name.trim(),
      name_np: currentForm.name_np.trim() || null,
      legal_name: currentForm.legal_name.trim() || null,
      pan_vat_no: currentForm.pan_vat_no.trim() || null,
    });
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {statusMessage ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {statusMessage}
        </p>
      ) : null}
      <Card title="Shop profile / पसल विवरण">
        <div className="mb-4 grid gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-3">
          <div>
            <span className="block text-xs text-muted-foreground">Subdomain</span>
            <span className="font-medium">{query.data.slug}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Plan</span>
            <span className="font-medium">{query.data.plan_code}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Timezone</span>
            <span className="font-medium">{query.data.timezone}</span>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Shop name"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Input
              label="Shop name (नेपाली)"
              value={form.name_np}
              onChange={(event) => setForm({ ...form, name_np: event.target.value })}
            />
            <Input
              label="Legal name"
              value={form.legal_name}
              onChange={(event) => setForm({ ...form, legal_name: event.target.value })}
            />
            <Input
              label="PAN / VAT number"
              value={form.pan_vat_no}
              onChange={(event) => setForm({ ...form, pan_vat_no: event.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.vat_registered}
              onChange={(event) => setForm({ ...form, vat_registered: event.target.checked })}
              className="accent-primary"
            />
            VAT registered shop
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Calendar preference
              <select
                value={form.calendar_pref}
                onChange={(event) =>
                  setForm({
                    ...form,
                    calendar_pref: event.target.value as SettingsForm['calendar_pref'],
                  })
                }
                className={`${selectClasses} font-normal`}
              >
                <option value="BS">Bikram Sambat (BS)</option>
                <option value="AD">Gregorian (AD)</option>
                <option value="BOTH">Both calendars</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Interface language
              <select
                value={form.locale}
                onChange={(event) =>
                  setForm({ ...form, locale: event.target.value as SettingsForm['locale'] })
                }
                className={`${selectClasses} font-normal`}
              >
                <option value="np">Nepali</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </form>
      </Card>
      {hasPermission(user, 'user.manage') ? (
        <Card title="Staff & roles / कर्मचारी">
          <p className="mb-3 text-sm text-muted-foreground">
            Create staff accounts and assign the roles already configured for this shop.
          </p>
          <Button asChild>
            <Link to="/settings/staff">Manage staff</Link>
          </Button>
        </Card>
      ) : null}
      {user?.is_owner ? (
        <Card title="Support access / सहायता पहुँच">
          <p className="mb-3 text-sm text-muted-foreground">
            Review every time Dokan support entered this shop and who ended the session.
          </p>
          <Button asChild variant="secondary">
            <Link to="/settings/support-access">View support access log</Link>
          </Button>
        </Card>
      ) : null}
    </main>
  );
}
