import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/switch';
import { deleteOverride, listOverrides, listPlans, setOverride } from '@/features/admin/api';
import { AdminCard } from '@/features/admin/components';
import { ApiError } from '@/lib/api/client';
import { PLAN_FEATURE_CATALOG } from '@/lib/plans';

/**
 * Friendly per-feature switches for a tenant: each row shows the effective
 * state, whether it comes from the plan or an override, and writes/removes a
 * `features.<name>` TenantFeatureOverride. The raw key/value editor stays
 * available below as an "Advanced" disclosure.
 */
export function FeatureTogglesPanel({
  tenantId,
  planId,
  canWrite,
}: {
  tenantId: string;
  planId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const overrides = useQuery({
    queryKey: ['platform', 'tenants', tenantId, 'overrides'],
    queryFn: () => listOverrides(tenantId),
  });
  // Same key as TenantDetailPage's plan query, so SUPER_ADMINs share the fetch.
  const plans = useQuery({
    queryKey: ['platform', 'plans', true],
    queryFn: () => listPlans(true),
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['platform', 'tenants', tenantId, 'overrides'] });
  const toggle = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean }) =>
      setOverride(tenantId, { key, value, expires_at: null, note: null }),
    onSuccess: invalidate,
  });
  const reset = useMutation({
    mutationFn: (id: string) => deleteOverride(tenantId, id),
    onSuccess: invalidate,
  });

  const planFeatures = plans.data?.data.find((plan) => plan.id === planId)?.features ?? {};
  const mutationError = toggle.isError ? toggle.error : reset.isError ? reset.error : null;

  return (
    <AdminCard
      title="Features"
      description="Effective feature switches for this shop: the plan default, or an override that wins until it expires."
    >
      <ul className="divide-y divide-border">
        {PLAN_FEATURE_CATALOG.map((entry) => {
          const override = overrides.data?.data.find((row) => row.key === `features.${entry.key}`);
          const planDefault = planFeatures[entry.key] === true;
          const effective = override ? override.value === true : planDefault;
          return (
            <li key={entry.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium">{entry.label}</p>
                <p className="text-xs text-muted-foreground">{entry.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge variant={override ? 'warning' : 'secondary'}>
                  {override ? 'Override' : 'Plan default'}
                </Badge>
                {override && canWrite ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={reset.isPending}
                    onClick={() => reset.mutate(override.id)}
                  >
                    Reset to plan default
                  </Button>
                ) : null}
                <Switch
                  aria-label={entry.label}
                  checked={effective}
                  disabled={!canWrite || toggle.isPending}
                  onCheckedChange={(checked) =>
                    toggle.mutate({ key: `features.${entry.key}`, value: checked })
                  }
                />
              </div>
            </li>
          );
        })}
      </ul>
      {mutationError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {mutationError instanceof ApiError
            ? mutationError.message
            : 'Could not update the feature.'}
        </p>
      ) : null}
    </AdminCard>
  );
}
