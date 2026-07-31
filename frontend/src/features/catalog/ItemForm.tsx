import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  createBrand,
  createCategory,
  createItem,
  createSizeChart,
  listBrands,
  listCategories,
  listSizeCharts,
  updateItem,
} from '@/features/catalog/api';
import type { Gender, Item, ItemPayload } from '@/features/catalog/api';
import { QuickAddSelect } from '@/features/catalog/QuickAddSelect';
import { ApiError } from '@/lib/api/client';

const GENDERS: Array<{ id: Gender; label: string }> = [
  { id: 'M', label: 'Men' },
  { id: 'F', label: 'Women' },
  { id: 'U', label: 'Unisex' },
  { id: 'KIDS', label: 'Kids' },
];

interface ItemFormProps {
  /** Present when editing; absent for create. */
  initial?: Item;
  onSaved: (item: Item) => void;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Item create/edit form. Taxonomy selects (category/brand/size chart) have
 * inline quick-add so a missing option never blocks the entry flow.
 */
export function ItemForm({ initial, onSaved }: ItemFormProps) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [nameNp, setNameNp] = useState(initial?.name_np ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [sizeChart, setSizeChart] = useState(initial?.size_chart ?? '');
  const [gender, setGender] = useState(initial?.gender ?? '');
  const [season, setSeason] = useState(initial?.season ?? '');
  const [collectionTag, setCollectionTag] = useState(initial?.collection_tag ?? '');
  const [hsnCode, setHsnCode] = useState(initial?.hsn_code ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? 'PCS');
  const [isVatApplicable, setIsVatApplicable] = useState(initial?.is_vat_applicable ?? false);
  const [minPrice, setMinPrice] = useState(initial?.min_selling_price ?? '');
  const [maxPrice, setMaxPrice] = useState(initial?.max_selling_price ?? '');
  const [reorderLevel, setReorderLevel] = useState(initial?.reorder_level ?? '');
  const [error, setError] = useState<string | null>(null);

  const taxonomies = useQuery({
    queryKey: ['catalog', 'taxonomies'],
    queryFn: async () => {
      const [categories, brands, sizeCharts] = await Promise.all([
        listCategories(),
        listBrands(),
        listSizeCharts(),
      ]);
      return {
        categories: categories.data.filter((c) => c.is_active),
        brands: brands.data.filter((b) => b.is_active),
        sizeCharts: sizeCharts.data.filter((s) => s.is_active),
      };
    },
    staleTime: 5 * 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: ItemPayload) =>
      initial ? updateItem(initial.id, payload) : createItem(payload),
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'items'] });
      onSaved(item);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save the item.'),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    saveMutation.mutate({
      code: code.trim(),
      name: name.trim(),
      name_np: blankToNull(nameNp),
      category: category || null,
      brand: brand || null,
      size_chart: sizeChart || null,
      gender: (gender || null) as Gender | null,
      season: blankToNull(season),
      collection_tag: blankToNull(collectionTag),
      hsn_code: blankToNull(hsnCode),
      unit: unit.trim() || 'PCS',
      is_vat_applicable: isVatApplicable,
      min_selling_price: blankToNull(minPrice),
      max_selling_price: blankToNull(maxPrice),
      reorder_level: blankToNull(reorderLevel),
    });
  };

  const refreshTaxonomies = () =>
    queryClient.invalidateQueries({ queryKey: ['catalog', 'taxonomies'] });

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} required />
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        label="Name (Nepali)"
        value={nameNp}
        onChange={(e) => setNameNp(e.target.value)}
      />
      <Input label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />

      <QuickAddSelect
        label="Category"
        options={taxonomies.data?.categories ?? []}
        value={category}
        onChange={setCategory}
        addLabel="+ New"
        onCreate={async (catName) => {
          const created = await createCategory({ name: catName });
          await refreshTaxonomies();
          return created;
        }}
      />
      <QuickAddSelect
        label="Brand"
        options={taxonomies.data?.brands ?? []}
        value={brand}
        onChange={setBrand}
        addLabel="+ New"
        onCreate={async (brandName) => {
          const created = await createBrand({ name: brandName });
          await refreshTaxonomies();
          return created;
        }}
      />
      <QuickAddSelect
        label="Size chart"
        options={taxonomies.data?.sizeCharts ?? []}
        value={sizeChart}
        onChange={setSizeChart}
        addLabel="+ New"
        extraField={{ label: 'Size values', placeholder: 'S, M, L, XL' }}
        onCreate={async (chartName, values) => {
          const created = await createSizeChart({
            name: chartName,
            values: values
              .split(',')
              .map((v) => v.trim())
              .filter((v) => v !== ''),
          });
          await refreshTaxonomies();
          return created;
        }}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="gender" className="text-sm font-medium text-slate-700">
          Gender
        </label>
        <select
          id="gender"
          value={gender}
          onChange={(e) => setGender(e.target.value as Gender | '')}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">— none —</option>
          {GENDERS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      <Input label="Season" value={season} onChange={(e) => setSeason(e.target.value)} />
      <Input
        label="Collection tag"
        value={collectionTag}
        onChange={(e) => setCollectionTag(e.target.value)}
      />
      <Input label="HSN code" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} />
      <Input
        label="Min selling price (रू)"
        value={minPrice}
        onChange={(e) => setMinPrice(e.target.value)}
        inputMode="decimal"
      />
      <Input
        label="Max selling price (रू)"
        value={maxPrice}
        onChange={(e) => setMaxPrice(e.target.value)}
        inputMode="decimal"
      />
      <Input
        label="Reorder level"
        value={reorderLevel}
        onChange={(e) => setReorderLevel(e.target.value)}
        inputMode="decimal"
      />

      <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={isVatApplicable}
          onChange={(e) => setIsVatApplicable(e.target.checked)}
          className="h-4 w-4"
        />
        VAT applicable
      </label>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" size="lg" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : initial ? 'Save changes' : 'Create item'}
        </Button>
      </div>
    </form>
  );
}
