/**
 * Sections of the quick-add product page: the size × colour picker (local
 * state only — one POST creates everything) and the opening-stock grid.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import type { SizeChart } from '@/features/catalog/api';
import { QuickAddSelect } from '@/features/catalog/QuickAddSelect';
import { cn } from '@/lib/utils';

const COMMON_COLORS = ['Black', 'White', 'Navy', 'Red', 'Grey', 'Green'];

const qtyInputClasses = [
  'h-9 w-24 rounded-md border border-input bg-background px-2 text-right text-sm shadow-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
].join(' ');

interface SizesColoursSectionProps {
  sizeCharts: SizeChart[];
  sizeChart: string;
  onSizeChartChange: (id: string) => void;
  onCreateSizeChart: (name: string, values: string) => Promise<SizeChart>;
  /** Currently selected sizes (chart values and/or custom). */
  sizes: string[];
  onToggleSize: (size: string) => void;
  colors: string[];
  onAddColor: (color: string) => void;
  onRemoveColor: (color: string) => void;
  mrp: string;
  onMrpChange: (value: string) => void;
}

/** Size-chart chips + custom sizes, colour chips, and the shared MRP. */
export function SizesColoursSection({
  sizeCharts,
  sizeChart,
  onSizeChartChange,
  onCreateSizeChart,
  sizes,
  onToggleSize,
  colors,
  onAddColor,
  onRemoveColor,
  mrp,
  onMrpChange,
}: SizesColoursSectionProps) {
  const { t } = useTranslation();
  const [customSize, setCustomSize] = useState('');
  const [colorInput, setColorInput] = useState('');

  const chartValues = sizeCharts.find((chart) => chart.id === sizeChart)?.values ?? [];
  const chipSizes = [...chartValues, ...sizes.filter((size) => !chartValues.includes(size))];

  const addCustomSize = () => {
    const size = customSize.trim();
    if (size !== '' && !sizes.includes(size)) {
      onToggleSize(size);
    }
    setCustomSize('');
  };

  const addColor = (raw: string) => {
    const color = raw.trim();
    if (color !== '') {
      onAddColor(color);
    }
    setColorInput('');
  };

  return (
    <div className="flex flex-col gap-4">
      <QuickAddSelect
        label={t('catalog.form.sizeChart')}
        options={sizeCharts}
        value={sizeChart}
        onChange={onSizeChartChange}
        addLabel={t('catalog.form.quickAdd')}
        extraField={{ label: t('catalog.form.sizeValues'), placeholder: 'S, M, L, XL' }}
        onCreate={onCreateSizeChart}
      />

      <div>
        <Label className="mb-2">{t('catalog.matrix.sizes')}</Label>
        <div className="flex flex-wrap gap-2">
          {chipSizes.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={sizes.includes(size)}
              onClick={() => onToggleSize(size)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm font-medium',
                sizes.includes(size)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground hover:bg-accent',
              )}
            >
              {size}
            </button>
          ))}
          <input
            aria-label={t('catalog.matrix.customSize')}
            value={customSize}
            onChange={(e) => setCustomSize(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustomSize();
              }
            }}
            placeholder={t('catalog.matrix.sizePlaceholder')}
            className="h-9 w-20 rounded-md border border-dashed border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div>
        <Label className="mb-2">{t('catalog.matrix.colours')}</Label>
        <div className="flex flex-wrap items-center gap-2">
          {colors.map((color) => (
            <Badge key={color} variant="secondary" className="gap-1 text-sm font-medium">
              {color}
              <button
                type="button"
                aria-label={t('catalog.matrix.removeColour', { color })}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onRemoveColor(color)}
              >
                ✕
              </button>
            </Badge>
          ))}
          {COMMON_COLORS.filter((color) => !colors.includes(color)).map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => addColor(color)}
              className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              + {color}
            </button>
          ))}
          <input
            aria-label={t('catalog.matrix.customColour')}
            value={colorInput}
            onChange={(e) => setColorInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addColor(colorInput);
              }
            }}
            placeholder={t('catalog.matrix.colourPlaceholder')}
            className="h-9 w-24 rounded-md border border-dashed border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <Input
        label={t('catalog.matrix.mrpLabel')}
        value={mrp}
        onChange={(e) => onMrpChange(e.target.value)}
        inputMode="decimal"
        placeholder="1500.00"
        className="w-40"
      />
    </div>
  );
}

interface OpeningStockSectionProps {
  /** Selected sizes × colours — one qty row per combination. */
  sizes: string[];
  colors: string[];
  quantities: Record<string, string>;
  onQuantityChange: (key: string, value: string) => void;
  unitCost: string;
  onUnitCostChange: (value: string) => void;
  note: string;
  onNoteChange: (value: string) => void;
  branchName: string | null;
}

/** Opening-stock grid: one qty input per size×colour combo, shared unit cost. */
export function OpeningStockSection({
  sizes,
  colors,
  quantities,
  onQuantityChange,
  unitCost,
  onUnitCostChange,
  note,
  onNoteChange,
  branchName,
}: OpeningStockSectionProps) {
  const { t } = useTranslation();
  const combos = sizes.flatMap((size) =>
    colors.map((color) => ({ size, color, key: `${size}::${color}` })),
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t('catalog.quickCreate.stockBranch', { branch: branchName ?? '…' })}
      </p>
      <div className="flex flex-col gap-2">
        {combos.map((combo) => (
          <div key={combo.key} className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {combo.size} / {combo.color}
            </span>
            <input
              aria-label={t('catalog.quickCreate.qtyAria', {
                size: combo.size,
                color: combo.color,
              })}
              value={quantities[combo.key] ?? ''}
              onChange={(e) => onQuantityChange(combo.key, e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className={qtyInputClasses}
            />
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={t('catalog.quickCreate.stockUnitCost')}
          value={unitCost}
          onChange={(e) => onUnitCostChange(e.target.value)}
          inputMode="decimal"
          placeholder="700.00"
        />
        <Input
          label={t('catalog.quickCreate.stockNote')}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
        />
      </div>
    </div>
  );
}
