import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { bulkCreateVariants } from '@/features/catalog/api';
import type { ItemVariant, VariantBulkResult } from '@/features/catalog/api';
import { ApiError } from '@/lib/api/client';

interface VariantMatrixProps {
  itemId: string;
  /** Sizes from the item's size chart; empty when the item has none. */
  sizeChartValues: string[];
  existingVariants: ItemVariant[];
  onCreated: () => void;
}

const COMMON_COLORS = ['Black', 'White', 'Navy', 'Red', 'Grey', 'Green'];

/**
 * Size × colour matrix entry — the design's #1 time-saver (§7.4): tick
 * sizes, add colours, one POST creates the whole grid. Combinations the
 * item already has are shown as "exists" and are skipped server-side
 * anyway (reported in the created/skipped summary).
 */
export function VariantMatrix({
  itemId,
  sizeChartValues,
  existingVariants,
  onCreated,
}: VariantMatrixProps) {
  const [sizes, setSizes] = useState<string[]>([]);
  const [customSize, setCustomSize] = useState('');
  const [colors, setColors] = useState<string[]>([]);
  const [colorInput, setColorInput] = useState('');
  const [mrp, setMrp] = useState('');
  const [result, setResult] = useState<VariantBulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existing = new Set(existingVariants.map((v) => `${v.size}::${v.color}`));
  const allSizes = [...sizeChartValues, ...sizes.filter((s) => !sizeChartValues.includes(s))];
  const selectedCount = sizes.length * colors.length;

  const toggleSize = (size: string) =>
    setSizes((current) =>
      current.includes(size) ? current.filter((s) => s !== size) : [...current, size],
    );

  const addColor = (raw: string) => {
    const color = raw.trim();
    if (color !== '' && !colors.includes(color)) {
      setColors((current) => [...current, color]);
    }
    setColorInput('');
  };

  const addCustomSize = () => {
    const size = customSize.trim();
    if (size !== '' && !sizes.includes(size)) {
      setSizes((current) => [...current, size]);
    }
    setCustomSize('');
  };

  const createMutation = useMutation({
    mutationFn: () =>
      bulkCreateVariants(itemId, {
        sizes,
        colors,
        ...(mrp.trim() !== '' ? { mrp: mrp.trim() } : {}),
      }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      onCreated();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not create variants.'),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Sizes</p>
        <div className="flex flex-wrap gap-2">
          {allSizes.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={sizes.includes(size)}
              onClick={() => toggleSize(size)}
              className={[
                'rounded-md border px-3 py-1.5 text-sm font-medium',
                sizes.includes(size)
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              {size}
            </button>
          ))}
          <input
            aria-label="Custom size"
            value={customSize}
            onChange={(e) => setCustomSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustomSize();
              }
            }}
            placeholder="+ size"
            className="w-20 rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Colours</p>
        <div className="flex flex-wrap items-center gap-2">
          {colors.map((color) => (
            <span
              key={color}
              className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-1 text-sm text-blue-900"
            >
              {color}
              <button
                type="button"
                aria-label={`Remove colour ${color}`}
                className="text-blue-700 hover:text-blue-900"
                onClick={() => setColors((current) => current.filter((c) => c !== color))}
              >
                ✕
              </button>
            </span>
          ))}
          {COMMON_COLORS.filter((c) => !colors.includes(c)).map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => addColor(color)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              + {color}
            </button>
          ))}
          <input
            aria-label="Custom colour"
            value={colorInput}
            onChange={(e) => setColorInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addColor(colorInput);
              }
            }}
            placeholder="+ colour"
            className="w-24 rounded-md border border-dashed border-slate-300 px-2 py-1 text-sm"
          />
        </div>
      </div>

      {selectedCount > 0 ? (
        <table
          aria-label="Variant grid preview"
          className="w-auto border-collapse text-xs"
        >
          <thead>
            <tr>
              <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-medium text-slate-500">
                Size \\ Colour
              </th>
              {colors.map((color) => (
                <th
                  key={color}
                  className="border border-slate-200 bg-slate-50 px-2 py-1 font-medium text-slate-700"
                >
                  {color}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sizes.map((size) => (
              <tr key={size}>
                <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-medium text-slate-700">
                  {size}
                </th>
                {colors.map((color) => (
                  <td
                    key={color}
                    className={[
                      'border border-slate-200 px-2 py-1 text-center',
                      existing.has(`${size}::${color}`) ? 'text-slate-400' : 'text-green-700',
                    ].join(' ')}
                  >
                    {existing.has(`${size}::${color}`) ? 'exists' : '✓'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="matrix-mrp" className="text-sm font-medium text-slate-700">
            MRP (रू, optional)
          </label>
          <input
            id="matrix-mrp"
            value={mrp}
            onChange={(e) => setMrp(e.target.value)}
            inputMode="decimal"
            placeholder="1500.00"
            className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <Button
          disabled={selectedCount === 0 || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending
            ? 'Creating…'
            : `Create ${selectedCount} variant${selectedCount === 1 ? '' : 's'}`}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {result ? (
        <div role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          <p>
            Created {result.created_count} variant{result.created_count === 1 ? '' : 's'}
            {result.skipped_count > 0
              ? `, skipped ${result.skipped_count} (already exist)`
              : ''}
            .
          </p>
          {result.skipped.length > 0 ? (
            <ul className="mt-1 text-xs text-green-700">
              {result.skipped.map((s) => (
                <li key={`${s.size}::${s.color}`}>
                  {s.size} / {s.color} — {s.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
