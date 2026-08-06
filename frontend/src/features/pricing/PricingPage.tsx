import { useQuery } from '@tanstack/react-query';

import { PriceEditor } from '@/features/pricing/PriceEditor';
import { PriceTables } from '@/features/pricing/PriceTables';
import { RateTypesPanel } from '@/features/pricing/RateTypesPanel';
import { listPricingRateTypes } from '@/features/pricing/api';
import { useAuth } from '@/features/auth/useAuth';
import { hasPermission } from '@/lib/permissions';

export function PricingPage() {
  const { user, isRestoring } = useAuth();
  const canView = hasPermission(user, 'pricing.view');
  const canEdit = hasPermission(user, 'pricing.edit');
  const canSetBounds = hasPermission(user, 'pricing.set_bounds');
  const rateTypes = useQuery({
    queryKey: ['pricing', 'rate-types'],
    queryFn: () => listPricingRateTypes(),
    enabled: canView,
  });

  if (isRestoring) {
    return <main className="p-6 text-sm text-muted-foreground">Loading pricing…</main>;
  }

  if (!canView) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p role="alert" className="mt-3 rounded-md bg-warning/10 p-3 text-sm text-warning">
          You do not have permission to view pricing.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Pricing / बिक्री मूल्य</h1>
        <p className="text-sm text-muted-foreground">
          Variant prices override item and category prices; MRP is the final fallback.
        </p>
      </div>
      {rateTypes.isError ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {rateTypes.error instanceof Error ? rateTypes.error.message : 'Could not load pricing.'}
        </p>
      ) : null}
      <RateTypesPanel rates={rateTypes.data?.data ?? []} canEdit={canEdit} />
      {canEdit ? (
        <PriceEditor rates={rateTypes.data?.data ?? []} canSetBounds={canSetBounds} />
      ) : null}
      <PriceTables />
    </main>
  );
}
