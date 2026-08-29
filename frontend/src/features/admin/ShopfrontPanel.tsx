import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { updateTenant } from '@/features/admin/api';
import type { Tenant } from '@/features/admin/api';
import { AdminCard, Field } from '@/features/admin/components';
import { ApiError } from '@/lib/api/client';

const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;

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
    ? `${window.location.protocol}//${tenant.shopfront_subdomain}.${rootHost()}`
    : null;
  const invalid = normalized !== '' && !SUBDOMAIN_RE.test(normalized);
  const unchanged = normalized === (tenant.shopfront_subdomain ?? '');

  return (
    <AdminCard
      title="Online store"
      description="Public e-commerce address for this shop. The storefront goes live with the e-commerce feature; assigning an address reserves it now."
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
              hint={`Becomes <subdomain>.${rootHost()} — must not clash with any shop subdomain.`}
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
