import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatNpr } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * A made-up shop that runs only in this component's state. It deliberately
 * imports no API client and logs in to nothing, so it has no route to tenant
 * data. Everything is gone when the visitor leaves the page.
 */
const ITEMS = [
  {
    id: 'kurta',
    name: 'Block-Print Cotton Kurta',
    min: 2200,
    max: 2650,
    stock: { M: 10, L: 6 },
  },
  {
    id: 'jacket',
    name: 'Denim Trucker Jacket',
    min: 3900,
    max: 4500,
    stock: { M: 4, L: 16 },
  },
  {
    id: 'cardigan',
    name: 'Wool Cardigan',
    min: 2800,
    max: 3400,
    stock: { M: 7, L: 3 },
  },
] as const;

type Item = (typeof ITEMS)[number];
type Size = keyof Item['stock'];
type Method = 'cash' | 'qr';
interface Sale {
  itemId: Item['id'];
  size: Size;
  price: number;
}

function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-11 rounded-md border px-3 text-left text-sm font-medium transition-colors',
              value === option.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background hover:bg-muted',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SampleShop() {
  const { t } = useTranslation();
  const [item, setItem] = useState<Item>(ITEMS[0]);
  const [size, setSize] = useState<Size>('M');
  const [price, setPrice] = useState<string>(String(ITEMS[0].max));
  const [method, setMethod] = useState<Method>('cash');
  const [sales, setSales] = useState<Sale[]>([]);

  const sold = sales.filter((sale) => sale.itemId === item.id && sale.size === size).length;
  const left = item.stock[size] - sold;
  const amount = Number(price);
  const total = sales.reduce((sum, sale) => sum + sale.price, 0);
  const lastSale = sales.at(-1);

  let error: string | undefined;
  if (!price.trim() || Number.isNaN(amount)) {
    error = t('simpleSale.validation.enterPrice');
  } else if (amount < item.min) {
    error = t('simpleSale.validation.minPrice', { price: formatNpr(item.min) });
  } else if (amount > item.max) {
    error = t('simpleSale.validation.maxPrice', { price: formatNpr(item.max) });
  } else if (left < 1) {
    error = t('simpleSale.validation.onlyInStock', { count: 0 });
  }

  function chooseItem(id: Item['id']) {
    const next = ITEMS.find((candidate) => candidate.id === id) ?? ITEMS[0];
    setItem(next);
    setPrice(String(next.max));
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-amber-400 bg-card p-4 shadow-card sm:p-6">
      <p className="rounded-md bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950">
        {t('landing.sampleBadge')}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{t('landing.sampleNotice')}</p>
      <p className="mt-4 font-semibold">{t('landing.sampleShopName')}</p>

      <div className="mt-4 space-y-4">
        <Choices
          label={t('landing.sampleItem')}
          options={ITEMS.map((option) => ({ value: option.id, label: option.name }))}
          value={item.id}
          onChange={chooseItem}
        />
        <Choices
          label={t('landing.sampleSize')}
          options={[
            { value: 'M', label: 'M' },
            { value: 'L', label: 'L' },
          ]}
          value={size}
          onChange={setSize}
        />
        <p className="text-sm text-muted-foreground">
          {t('landing.sampleStock', { count: left })}
        </p>
        <Input
          label={t('simpleSale.line.price')}
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          error={error}
          className="h-11 text-base"
        />
        <p className="text-sm text-muted-foreground">
          {t('simpleSale.validation.priceRange', {
            min: formatNpr(item.min),
            max: formatNpr(item.max),
          })}
        </p>
        <Choices
          label={t('simpleSale.paymentMethod')}
          options={[
            { value: 'cash', label: t('simpleSale.cash') },
            { value: 'qr', label: t('simpleSale.qr') },
          ]}
          value={method}
          onChange={setMethod}
        />
        <Button
          size="lg"
          className="w-full"
          disabled={error !== undefined}
          onClick={() =>
            setSales((previous) => [...previous, { itemId: item.id, size, price: amount }])
          }
        >
          {t('simpleSale.complete')}
        </Button>
      </div>

      {lastSale ? (
        <p role="status" className="mt-4 text-sm font-medium text-success">
          {t('landing.sampleDone', {
            number: sales.length,
            amount: formatNpr(lastSale.price),
          })}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t pt-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t('landing.sampleTodayBills')}</dt>
          <dd className="text-lg font-semibold tabular-nums">{sales.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('landing.sampleTodaySales')}</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatNpr(total)}</dd>
        </div>
      </dl>
    </div>
  );
}
