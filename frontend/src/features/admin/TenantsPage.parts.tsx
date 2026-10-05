import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/Input';
import { createTenant } from '@/features/admin/api';
import type { Plan, TenantCreatePayload, TenantStatus } from '@/features/admin/api';
import { Field } from '@/features/admin/components';
import { ApiError } from '@/lib/api/client';

const SLUG_PATTERN = /^[a-z0-9-]{3,30}$/;

const selectClasses =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface NewTenantDialogProps {
  open: boolean;
  /** Active plans offered in the plan select. */
  plans: Plan[];
  onOpenChange: (open: boolean) => void;
}

function blankForm(plan: string): TenantCreatePayload {
  return {
    slug: '',
    name: '',
    plan,
    status: 'TRIAL',
    trial_ends_at: null,
    owner_phone: '',
    owner_full_name: '',
    owner_email: null,
    owner_password: '',
    branch_code: 'MAIN',
    branch_name: 'Main Branch',
  };
}

/**
 * Provisioning dialog: tenant + owner + default branch in one POST. Mounted
 * fresh on every open (the parent renders it only while open), so its local
 * state never leaks between attempts.
 */
export function NewTenantDialog({ open, plans, onOpenChange }: NewTenantDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TenantCreatePayload>(() => blankForm(plans[0]?.id ?? ''));
  const [fieldErrors, setFieldErrors] = useState<{ slug?: string; owner_password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createTenant,
    onSuccess: async (tenant) => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
      onOpenChange(false);
      navigate(`/admin/tenants/${tenant.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFormError(error.body?.code ? `${error.body.code}: ${error.message}` : error.message);
      } else {
        setFormError('Could not provision the tenant.');
      }
    },
  });

  const patch = (values: Partial<TenantCreatePayload>) =>
    setForm((prev) => ({ ...prev, ...values }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const slug = form.slug.trim().toLowerCase();
    const errors: typeof fieldErrors = {};
    if (!SLUG_PATTERN.test(slug)) {
      errors.slug = 'Use 3–30 characters: lowercase letters, numbers and hyphens only.';
    }
    if (form.owner_password.length < 12) {
      errors.owner_password = 'Password must be at least 12 characters.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    mutation.mutate({
      ...form,
      slug,
      name: form.name.trim(),
      owner_phone: form.owner_phone.trim(),
      owner_full_name: form.owner_full_name.trim(),
      owner_email: form.owner_email?.trim() || null,
      trial_ends_at: form.trial_ends_at ? new Date(form.trial_ends_at).toISOString() : null,
      branch_code: form.branch_code.trim() || 'MAIN',
      branch_name: form.branch_name.trim() || 'Main Branch',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New tenant</DialogTitle>
          <DialogDescription>
            Provisions the tenant, its owner login and the default branch in one step.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label="Shop name" htmlFor="tenant-name">
            <Input
              id="tenant-name"
              required
              value={form.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>
          <Field
            label="Subdomain"
            htmlFor="tenant-slug"
            error={fieldErrors.slug}
            hint={fieldErrors.slug ? undefined : 'Becomes <slug>.dokan.com.np — immutable later.'}
          >
            <Input
              id="tenant-slug"
              required
              value={form.slug}
              onChange={(event) => patch({ slug: event.target.value })}
            />
          </Field>
          <Field label="Plan" htmlFor="tenant-plan">
            <select
              id="tenant-plan"
              required
              value={form.plan}
              onChange={(event) => patch({ plan: event.target.value })}
              className={selectClasses}
            >
              <option value="">Select a plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="tenant-status">
            <select
              id="tenant-status"
              value={form.status}
              onChange={(event) => patch({ status: event.target.value as TenantStatus })}
              className={selectClasses}
            >
              <option value="TRIAL">TRIAL</option>
              <option value="ACTIVE">ACTIVE</option>
            </select>
          </Field>
          <Field label="Trial ends" htmlFor="tenant-trial-ends" hint="Optional.">
            <Input
              id="tenant-trial-ends"
              type="datetime-local"
              value={form.trial_ends_at ?? ''}
              onChange={(event) => patch({ trial_ends_at: event.target.value || null })}
            />
          </Field>
          <Field label="Owner name" htmlFor="tenant-owner-name">
            <Input
              id="tenant-owner-name"
              required
              value={form.owner_full_name}
              onChange={(event) => patch({ owner_full_name: event.target.value })}
            />
          </Field>
          <Field label="Owner phone" htmlFor="tenant-owner-phone">
            <Input
              id="tenant-owner-phone"
              required
              value={form.owner_phone}
              onChange={(event) => patch({ owner_phone: event.target.value })}
            />
          </Field>
          <Field label="Owner email" htmlFor="tenant-owner-email" hint="Optional.">
            <Input
              id="tenant-owner-email"
              type="email"
              value={form.owner_email ?? ''}
              onChange={(event) => patch({ owner_email: event.target.value })}
            />
          </Field>
          <Field
            label="Owner password"
            htmlFor="tenant-owner-password"
            error={fieldErrors.owner_password}
            hint={
              fieldErrors.owner_password
                ? undefined
                : 'Minimum 12 characters — generate a strong passphrase; the owner can change it after first login.'
            }
          >
            <Input
              id="tenant-owner-password"
              type="password"
              required
              minLength={12}
              value={form.owner_password}
              onChange={(event) => patch({ owner_password: event.target.value })}
            />
          </Field>
          <Field label="Branch code" htmlFor="tenant-branch-code">
            <Input
              id="tenant-branch-code"
              required
              value={form.branch_code}
              onChange={(event) => patch({ branch_code: event.target.value })}
            />
          </Field>
          <Field label="Branch name" htmlFor="tenant-branch-name">
            <Input
              id="tenant-branch-name"
              required
              value={form.branch_name}
              onChange={(event) => patch({ branch_name: event.target.value })}
            />
          </Field>

          {formError ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2"
            >
              {formError}
            </p>
          ) : null}

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.plan}>
              {mutation.isPending ? 'Provisioning…' : 'Provision tenant'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
