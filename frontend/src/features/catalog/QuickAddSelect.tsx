import { useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';

interface QuickAddSelectProps<T extends { id: string; name: string }> {
  label: string;
  options: T[];
  value: string;
  onChange: (id: string) => void;
  /** Create-and-select; receives the name and the optional extra field. */
  onCreate: (name: string, extra: string) => Promise<T>;
  addLabel: string;
  /** Optional second input (e.g. size-chart values, comma separated). */
  extraField?: { label: string; placeholder: string };
  children?: ReactNode;
}

/**
 * Select with an inline quick-add — the counter creates a missing
 * category/brand/size chart without leaving the item form.
 */
export function QuickAddSelect<T extends { id: string; name: string }>({
  label,
  options,
  value,
  onChange,
  onCreate,
  addLabel,
  extraField,
}: QuickAddSelectProps<T>) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim() || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await onCreate(name.trim(), extra.trim());
      onChange(created.id);
      setAdding(false);
      setName('');
      setExtra('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="flex gap-2">
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">— none —</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          size="sm"
          className="whitespace-nowrap"
          onClick={() => setAdding((a) => !a)}
        >
          {adding ? 'Cancel' : addLabel}
        </Button>
      </div>
      {adding ? (
        <div className="mt-1 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <input
            aria-label={`New ${label} name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {extraField ? (
            <input
              aria-label={extraField.label}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={extraField.placeholder}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          ) : null}
          <Button size="sm" disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
