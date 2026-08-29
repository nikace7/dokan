import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { updateTenant } from '@/features/admin/api';
import type { Tenant } from '@/features/admin/api';
import { AdminCard, Field } from '@/features/admin/components';
import { ApiError } from '@/lib/api/client';

const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;
const TEMPLATES = [
  { value: 'aurora', label: 'Aurora — minimal boutique' },
  { value: 'bazaar', label: 'Bazaar — vibrant marketplace' },
] as const;

/** Root host for storefront URLs — strip the `admin.` prefix, keep the port. */
function rootHost(): string {
  const host = window.location.hostname;
  const root = host.startsWith('admin.') ? host.slice('admin.'.length) : host;
  return window.location.port ? `${root}:${window.location.port}` : root;
}

/**
 * Online-store address management. Assigning a subdomain reserves the
 * tenant's public storefront host; the storefront itself ships with the
 * e-commerce feature and stays dark until then. SUPER_ADMIN only.
 */
export function ShopfrontPanel({ tenant, canWrite }: { tenant: Tenant; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(tenant.shopfront_subdomain ?? '');
  const mutation = useMutation({
    mutationFn: (subdomain: string | null) =>
      updateTenant(tenant.id, { shopfront_subdomain: subdomain }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants', tenant.id] });
    },
  });

  const normalized = value.trim().toLowerCase();
  const currentUrl = tenant.shopfront_subdomain
    ? `${window.location.protocol}//${tenant.shopfront_subdomain}.shop.${rootHost()}`
    : null;
  const invalid = normalized !== '' && !SUBDOMAIN_RE.test(normalized);
  const unchanged = normalized === (tenant.shopfront_subdomain ?? '');
  const templateMutation = useMutation({
    mutationFn: (template: Tenant['shopfront_template']) =>
      updateTenant(tenant.id, { shopfront_template: template }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants', tenant.id] });
    },
  });

  return (
    <AdminCard
      title="Online store"
      description="Public e-commerce address and design template for this shop. The store serves once the shop's plan includes e-commerce."
    >
      <div className="flex flex-col gap-3 text-sm">
        {currentUrl ? (
          <p>
            Storefront address:{' '}
            <a
              className="font-medium text-primary hover:underline"
              href={currentUrl}
              target="_blank"
              rel="noreferrer"
            >
              {currentUrl}
            </a>
          </p>
        ) : (
          <p className="text-muted-foreground">No online-store address assigned yet.</p>
        )}
        {tenant.shopfront_subdomain ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Design template</span>
            {canWrite ? (
              <select
                value={tenant.shopfront_template}
                disabled={templateMutation.isPending}
                onChange={(event) =>
                  templateMutation.mutate(event.target.value as Tenant['shopfront_template'])
                }
                aria-label="Storefront template"
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {TEMPLATES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-medium text-foreground">
                {TEMPLATES.find((option) => option.value === tenant.shopfront_template)?.label ??
                  tenant.shopfront_template}
              </span>
            )}
          </div>
        ) : null}
        {canWrite ? (
          <>
            <Field
              label="Storefront subdomain"
              htmlFor="shopfront-subdomain"
              error={
                invalid
                  ? 'Use 3–30 lowercase letters, digits, and hyphens.'
                  : mutation.isError
                    ? mutation.error instanceof ApiError
                      ? mutation.error.message
                      : 'Could not update the storefront address.'
                    : undefined
              }
              hint={`Becomes <subdomain>.shop.${rootHost()} — must not clash with any shop subdomain.`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="shopfront-subdomain"
                  className="w-56"
                  placeholder="e.g. yak-store"
                  value={value}
                  disabled={mutation.isPending}
                  onChange={(event) => setValue(event.target.value)}
                />
                <Button
                  size="sm"
                  disabled={mutation.isPending || invalid || unchanged || normalized === ''}
                  onClick={() => mutation.mutate(normalized)}
                >
                  {mutation.isPending ? 'Saving…' : 'Save address'}
                </Button>
                {tenant.shopfront_subdomain ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() => {
                      setValue('');
                      mutation.mutate(null);
                    }}
                  >
                    Disable store
                  </Button>
                ) : null}
              </div>
            </Field>
          </>
        ) : null}
      </div>
    </AdminCard>
  );
}
