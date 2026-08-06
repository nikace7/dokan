import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { selectClasses } from '@/features/catalog/ui';

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
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t('catalog.quickAdd.createError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={selectClasses}
        >
          <option value="">{t('catalog.form.none')}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          size="sm"
          className="h-9 whitespace-nowrap"
          onClick={() => setAdding((a) => !a)}
        >
          {adding ? t('common.cancel') : addLabel}
        </Button>
      </div>
      {adding ? (
        <div className="mt-1 flex flex-col gap-2 rounded-md border border-border bg-muted/50 p-2">
          <Input
            aria-label={t('catalog.quickAdd.newName', { label })}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('catalog.quickAdd.namePlaceholder')}
          />
          {extraField ? (
            <Input
              aria-label={extraField.label}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={extraField.placeholder}
            />
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <Button size="sm" disabled={busy || !name.trim()} onClick={() => void create()}>
            {busy ? t('catalog.quickAdd.adding') : t('catalog.quickAdd.add')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
