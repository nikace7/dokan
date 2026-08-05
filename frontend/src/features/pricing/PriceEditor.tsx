import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { listCategories, listItems, listVariants } from '@/features/catalog/api';
import { setPrice, setPriceBounds } from '@/features/pricing/api';
import type { PriceScope } from '@/features/pricing/api';
import type { RateType } from '@/features/settings/api';
import { ApiError } from '@/lib/api/client';

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export function PriceEditor({ rates, canSetBounds }: { rates: RateType[]; canSetBounds: boolean }) {
  const queryClient = useQueryClient();
  const [rateType, setRateType] = useState('');
  const [scope, setScope] = useState<PriceScope>('VARIANT');
  const [itemId, setItemId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [price, setPriceValue] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [effectiveTo, setEffectiveTo] = useState('');
  const [reason, setReason] = useState('');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: listCategories,
    staleTime: 5 * 60_000,
  });
  const items = useQuery({
    queryKey: ['catalog', 'items', 'pricing-targets'],
    queryFn: () => listItems({ isActive: true, limit: 200 }),
    staleTime: 60_000,
  });
  const variants = useQuery({
    queryKey: ['catalog', 'variants', itemId],
    queryFn: () => listVariants(itemId),
    enabled: scope === 'VARIANT' && Boolean(itemId),
  });

  const selectedRate = rateType || rates.find((rate) => rate.is_default)?.id || rates[0]?.id || '';
  const selectedTarget = scope === 'ITEM' ? itemId : targetId;
  const savePrice = useMutation({
    mutationFn: () =>
      setPrice({
        rate_type: selectedRate,
        scope,
        ...(scope === 'VARIANT' ? { variant: targetId } : {}),
        ...(scope === 'ITEM' ? { item: itemId } : {}),
        ...(scope === 'CATEGORY' ? { category: targetId } : {}),
        price,
        effective_from: effectiveFrom,
        effective_to: effectiveTo || null,
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pricing', 'prices'] }),
        queryClient.invalidateQueries({ queryKey: ['pricing', 'changes'] }),
      ]);
      setPriceValue('');
      setReason('');
      setStatus('Selling price saved.');
    },
  });
  const saveBounds = useMutation({
    mutationFn: () =>
      setPriceBounds(scope === 'VARIANT' ? 'variant' : 'item', selectedTarget, {
        min_selling_price: minimum || null,
        max_selling_price: maximum || null,
      }),
    onSuccess: () => setStatus('Selling-price bounds saved.'),
  });

  const changeScope = (next: PriceScope) => {
    setScope(next);
    setItemId('');
    setTargetId('');
    setMinimum('');
    setMaximum('');
    setStatus(null);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setStatus(null);
    savePrice.mutate();
  };
  const error = savePrice.error ?? saveBounds.error;

  return (
    <Card title="Set effective selling price">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Rate type
          <select
            required
            value={selectedRate}
            onChange={(event) => setRateType(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
          >
            {rates
              .filter((rate) => rate.is_active)
              .map((rate) => (
                <option key={rate.id} value={rate.id}>
                  {rate.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Price scope
          <select
            value={scope}
            onChange={(event) => changeScope(event.target.value as PriceScope)}
            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
          >
            <option value="VARIANT">Variant</option>
            <option value="ITEM">Item</option>
            <option value="CATEGORY">Category</option>
          </select>
        </label>
        {scope === 'CATEGORY' ? (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 lg:col-span-2">
            Category target
            <select
              required
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 font-normal"
            >
              <option value="">Select category</option>
              {categories.data?.data
                .filter((category) => category.is_active)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Item target
              <select
                required
                value={itemId}
                onChange={(event) => {
                  setItemId(event.target.value);
                  setTargetId('');
                }}
                className="rounded-md border border-slate-300 px-3 py-2 font-normal"
              >
                <option value="">Select item</option>
                {items.data?.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            {scope === 'VARIANT' ? (
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Variant target
                <select
                  required
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                  disabled={!itemId}
                  className="rounded-md border border-slate-300 px-3 py-2 font-normal"
                >
                  <option value="">Select variant</option>
                  {variants.data?.data.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.sku} · {variant.size} / {variant.color}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        )}
        <Input
          label="Selling price"
          required
          inputMode="decimal"
          value={price}
          onChange={(event) => setPriceValue(event.target.value)}
        />
        <Input
          label="Effective from"
          type="date"
          required
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
        />
        <Input
          label="Effective to"
          type="date"
          value={effectiveTo}
          onChange={(event) => setEffectiveTo(event.target.value)}
        />
        <Input
          label="Change reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="sm:col-span-2 lg:col-span-4">
          <Button
            type="submit"
            disabled={savePrice.isPending || !selectedRate || !selectedTarget || !price}
          >
            Save price
          </Button>
        </div>
      </form>

      {canSetBounds && (scope === 'ITEM' || scope === 'VARIANT') ? (
        <section className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="mb-2 text-sm font-semibold">Optional selling-price guardrails</h3>
          <p className="mb-3 text-xs text-slate-500">Leave both blank to clear the guardrails.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Minimum selling price"
              inputMode="decimal"
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
            />
            <Input
              label="Maximum selling price"
              inputMode="decimal"
              value={maximum}
              onChange={(event) => setMaximum(event.target.value)}
            />
            <Button
              variant="secondary"
              disabled={saveBounds.isPending || !selectedTarget}
              onClick={() => saveBounds.mutate()}
            >
              Save bounds
            </Button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error instanceof ApiError ? error.message : 'Could not save pricing.'}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="mt-3 text-sm text-green-700">
          {status}
        </p>
      ) : null}
    </Card>
  );
}
