import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  listOverrides,
  listPlans,
  setOverride,
  updateTenant,
} from '@/features/admin/api';
import type { Tenant } from '@/features/admin/api';
import { AdminCard, Field } from '@/features/admin/components';
import { ApiError } from '@/lib/api/client';

const SUBDOMAIN_RE = /^[a-z0-9-]{3,30}$/;
const TEMPLATES = [
  { value: 'aurora', label: 'Aurora — minimal boutique' },
  { value: 'bazaar', label: 'Bazaar — elegant marketplace' },
] as const;

/** Root host for storefront URLs — strip the `admin.` prefix, keep the port. */
function rootHost(): string {
  const host = window.location.hostname;
  const root = host.startsWith('admin.') ? host.slice('admin.'.length) : host;
  return window.location.port ? `${root}:${window.location.port}` : root;
}

function Step({
  done,
  title,
  children,
}: {
  done: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          done ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
        }`}
      >
        {done ? '✓' : '•'}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${done ? '' : 'text-muted-foreground'}`}>{title}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * Guided online-store setup: turn the service on, assign the public address,
 * pick the design — the card doubles as the shop's storefront status panel
 * once live. SUPER_ADMIN writes; other roles see a read-only status board.
 */
export function ShopfrontPanel({ tenant, canWrite }: { tenant: Tenant; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(tenant.shopfront_subdomain ?? '');

  // Effective ecommerce state, computed exactly like FeatureTogglesPanel does
  // (shared query keys mean no extra requests when both cards are on screen).
  const overrides = useQuery({
    queryKey: ['platform', 'tenants', tenant.id, 'overrides'],
    queryFn: () => listOverrides(tenant.id),
  });
  const plans = useQuery({ queryKey: ['platform', 'plans', true], queryFn: () => listPlans(true) });
  const ecommerceOverride = overrides.data?.data.find((row) => row.key === 'features.ecommerce');
  const planDefault =
    plans.data?.data.find((plan) => plan.id === tenant.plan)?.features?.ecommerce === true;
  const ecommerceOn = ecommerceOverride ? ecommerceOverride.value === true : planDefault;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants', tenant.id] });
  };
  const mutation = useMutation({
    mutationFn: (subdomain: string | null) =>
      updateTenant(tenant.id, { shopfront_subdomain: subdomain }),
    onSuccess: invalidate,
  });
  const templateMutation = useMutation({
    mutationFn: (template: Tenant['shopfront_template']) =>
      updateTenant(tenant.id, { shopfront_template: template }),
    onSuccess: invalidate,
  });
  const enableMutation = useMutation({
    mutationFn: () =>
      setOverride(tenant.id, { key: 'features.ecommerce', value: true, expires_at: null, note: null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['platform', 'tenants', tenant.id, 'overrides'],
      });
    },
  });

  const normalized = value.trim().toLowerCase();
  const hasAddress = tenant.shopfront_subdomain !== null;
  const isLive = ecommerceOn && hasAddress;
  const storeUrl = hasAddress
    ? `${window.location.protocol}//${tenant.shopfront_subdomain}.shop.${rootHost()}`
    : null;
  const invalid = normalized !== '' && !SUBDOMAIN_RE.test(normalized);
  const unchanged = normalized === (tenant.shopfront_subdomain ?? '');

  return (
    <AdminCard
      title="Online store"
      description="The shop's public e-commerce site. Set it up in order — the shop then manages its content, offers, and website prices itself from Settings → Online store."
    >
      <ol className="flex flex-col gap-4">
        <Step done={ecommerceOn} title="1 · E-commerce service enabled">
          {!ecommerceOn && canWrite ? (
            <div className="mt-1.5">
              <Button
                size="sm"
                variant="secondary"
                disabled={enableMutation.isPending}
                onClick={() => enableMutation.mutate()}
              >
                {enableMutation.isPending ? 'Enabling…' : 'Enable for this shop'}
              </Button>
              {enableMutation.isError ? (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {enableMutation.error instanceof ApiError
                    ? enableMutation.error.message
                    : 'Could not enable the service.'}
                </p>
              ) : null}
            </div>
          ) : null}
          {!ecommerceOn && !canWrite ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Off for this plan — a SUPER_ADMIN can override it here or via Features below.
            </p>
          ) : null}
        </Step>

        <Step done={hasAddress} title="2 · Store address assigned">
          {canWrite ? (
            <div className="mt-1.5">
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
                  {hasAddress ? (
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
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tenant.shopfront_subdomain ?? 'No address assigned yet.'}
            </p>
          )}
        </Step>

        <Step done={hasAddress} title="3 · Design template">
          {hasAddress ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
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
                <span className="text-sm font-medium text-foreground">
                  {TEMPLATES.find((option) => option.value === tenant.shopfront_template)?.label ??
                    tenant.shopfront_template}
                </span>
              )}
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Assign the address first — the template applies to it.
            </p>
          )}
        </Step>

        <Step done={isLive} title="4 · Store is live">
          {isLive && storeUrl ? (
            <p className="mt-1 text-sm">
              <a
                className="font-medium text-primary hover:underline"
                href={storeUrl}
                target="_blank"
                rel="noreferrer"
              >
                {storeUrl}
              </a>
              <span className="mt-1 block text-xs text-muted-foreground">
                Hand off to the shop: they set their headline, announcement, offer, and website
                prices from their Settings → Online store screen.
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              The store serves once the service is on and the address is assigned.
            </p>
          )}
        </Step>
      </ol>
    </AdminCard>
  );
}
