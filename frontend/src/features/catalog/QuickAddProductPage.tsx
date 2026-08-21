import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  createBrand,
  createCategory,
  createSizeChart,
  listBrands,
  listCategories,
  listSizeCharts,
  quickCreateProduct,
  uploadItemImage,
} from '@/features/catalog/api';
import type {
  Gender,
  QuickCreateProductPayload,
  QuickCreateProductResult,
} from '@/features/catalog/api';
import {
  EMPTY_DETAILS,
  MoreDetailsSection,
  PhotoPicker,
} from '@/features/catalog/QuickAddProductDetails';
import type { DetailsState } from '@/features/catalog/QuickAddProductDetails';
import {
  OpeningStockSection,
  SizesColoursSection,
} from '@/features/catalog/QuickAddProductPage.parts';
import { QuickAddSelect } from '@/features/catalog/QuickAddSelect';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { ApiError } from '@/lib/api/client';

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Default single variant for shops that don't track sizes/colours. */
const DEFAULT_SIZE = 'Free Size';
const DEFAULT_COLOR = 'Standard';

/**
 * One-page "Add product" flow: item details, size×colour variants, and
 * opening stock in a single POST /catalog/products/quick-create. Replaces
 * the old create-item → variant-matrix → opening-stock hop for CREATE;
 * editing still uses ItemFormPage.
 */
export function QuickAddProductPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspace = useWorkspace();

  // Product
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [reorderLevel, setReorderLevel] = useState('');
  // More details (collapsed by default)
  const [showMore, setShowMore] = useState(false);
  const [details, setDetails] = useState<DetailsState>(EMPTY_DETAILS);
  // Sizes & colours
  const [sizeChart, setSizeChart] = useState('');
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [mrp, setMrp] = useState('');
  // Opening stock
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [unitCost, setUnitCost] = useState('');
  const [note, setNote] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickCreateProductResult | null>(null);

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
  const refreshTaxonomies = () =>
    queryClient.invalidateQueries({ queryKey: ['catalog', 'taxonomies'] });

  const createMutation = useMutation({
    mutationFn: (payload: QuickCreateProductPayload) => quickCreateProduct(payload),
    onSuccess: async (data) => {
      // The product exists; a failed photo upload is retryable from edit.
      if (pendingImage) {
        try {
          await uploadItemImage(data.item.id, pendingImage);
        } catch {
          // best-effort
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'items'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setResult(data);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('catalog.quickCreate.saveError')),
  });

  const resetForm = () => {
    setPendingImage(null);
    setImageError(null);
    setCode('');
    setName('');
    setCategory('');
    setMinPrice('');
    setMaxPrice('');
    setReorderLevel('');
    setShowMore(false);
    setDetails(EMPTY_DETAILS);
    setSizeChart('');
    setSizes([]);
    setColors([]);
    setMrp('');
    setQuantities({});
    setUnitCost('');
    setNote('');
    setError(null);
    setResult(null);
  };

  const toggleSize = (size: string) =>
    setSizes((current) =>
      current.includes(size) ? current.filter((s) => s !== size) : [...current, size],
    );
  const addColor = (color: string) => {
    if (!colors.includes(color)) setColors((current) => [...current, color]);
  };
  const removeColor = (color: string) => setColors((current) => current.filter((c) => c !== color));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!code.trim() || !name.trim()) {
      setError(t('catalog.quickCreate.errorRequired'));
      return;
    }
    const entered = Object.fromEntries(
      Object.entries(quantities).filter(([, qty]) => qty.trim() !== '' && Number(qty) > 0),
    );
    let stock: QuickCreateProductPayload['stock'];
    if (Object.keys(entered).length > 0) {
      if (!unitCost.trim()) {
        setError(t('catalog.quickCreate.stockUnitCostRequired'));
        return;
      }
      if (!workspace.branchId) {
        setError(t('inventory.operation.selectBranch'));
        return;
      }
      stock = {
        branch: workspace.branchId,
        unit_cost: unitCost.trim(),
        note: note.trim(),
        quantities: entered,
      };
    }
    createMutation.mutate({
      code: code.trim(),
      name: name.trim(),
      name_np: blankToNull(details.nameNp),
      category: category || null,
      brand: details.brand || null,
      size_chart: sizeChart || null,
      gender: (details.gender || null) as Gender | null,
      season: blankToNull(details.season),
      collection_tag: blankToNull(details.collectionTag),
      hsn_code: blankToNull(details.hsnCode),
      unit: details.unit.trim() || 'PCS',
      is_vat_applicable: details.isVatApplicable,
      min_selling_price: blankToNull(minPrice),
      max_selling_price: blankToNull(maxPrice),
      reorder_level: blankToNull(reorderLevel),
      sizes: effectiveSizes,
      colors: effectiveColors,
      mrp: blankToNull(mrp),
      ...(stock ? { stock } : {}),
    });
  };

  // Sizes/colours are optional: a shop that doesn't track them gets one
  // "Free Size / Standard" variant — the same default the data setup used.
  const effectiveSizes = sizes.length > 0 ? sizes : [DEFAULT_SIZE];
  const effectiveColors = colors.length > 0 ? colors : [DEFAULT_COLOR];

  const branchName =
    workspace.branches.find((branch) => branch.id === workspace.branchId)?.name ?? null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <div>
        <Link className="text-sm text-primary hover:underline" to="/catalog">
          ← {t('catalog.detail.back')}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{t('catalog.quickCreate.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('catalog.quickCreate.subtitle')}</p>
      </div>

      {result ? (
        <Card>
          <div
            role="status"
            className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
          >
            <p className="font-medium">
              {t('catalog.quickCreate.success', { name: result.item.name })}
            </p>
            <p>
              {t('catalog.matrix.created', { count: result.variants_created })}
              {result.stock_movements > 0
                ? ` · ${t('catalog.quickCreate.successStock', { count: result.stock_movements })}`
                : ''}
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button size="lg" className="w-full sm:w-auto" onClick={resetForm}>
              {t('catalog.quickCreate.addAnother')}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => navigate(`/catalog/items/${result.item.id}`)}
            >
              {t('catalog.quickCreate.viewProduct')}
            </Button>
          </div>
        </Card>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Card title={t('catalog.quickCreate.productSection')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <PhotoPicker
                altName={name.trim() || t('catalog.form.image')}
                pendingImage={pendingImage}
                imageError={imageError}
                onImageError={setImageError}
                onSelected={setPendingImage}
                onClear={() => setPendingImage(null)}
              />
              <Input
                label={t('catalog.form.code')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <Input
                label={t('catalog.form.name')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <QuickAddSelect
                label={t('catalog.form.category')}
                options={taxonomies.data?.categories ?? []}
                value={category}
                onChange={setCategory}
                addLabel={t('catalog.form.quickAdd')}
                onCreate={async (catName) => {
                  const created = await createCategory({ name: catName });
                  await refreshTaxonomies();
                  return created;
                }}
              />
              <Input
                label={t('catalog.form.reorderLevel')}
                value={reorderLevel}
                onChange={(e) => setReorderLevel(e.target.value)}
                inputMode="decimal"
              />
              <Input
                label={t('catalog.form.minPrice')}
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                inputMode="decimal"
              />
              <Input
                label={t('catalog.form.maxPrice')}
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <MoreDetailsSection
              details={details}
              onChange={(patch) => setDetails((current) => ({ ...current, ...patch }))}
              expanded={showMore}
              onToggle={() => setShowMore((value) => !value)}
              brands={taxonomies.data?.brands ?? []}
              onCreateBrand={async (brandName) => {
                const created = await createBrand({ name: brandName });
                await refreshTaxonomies();
                return created;
              }}
            />
          </Card>

          <Card title={t('catalog.quickCreate.variantsSection')}>
            <p className="mb-3 text-xs text-muted-foreground">
              {t('catalog.quickCreate.sizeColourOptionalHint')}
            </p>
            <SizesColoursSection
              sizeCharts={taxonomies.data?.sizeCharts ?? []}
              sizeChart={sizeChart}
              onSizeChartChange={setSizeChart}
              onCreateSizeChart={async (chartName, values) => {
                const created = await createSizeChart({
                  name: chartName,
                  values: values
                    .split(',')
                    .map((value) => value.trim())
                    .filter((value) => value !== ''),
                });
                await refreshTaxonomies();
                return created;
              }}
              sizes={sizes}
              onToggleSize={toggleSize}
              colors={colors}
              onAddColor={addColor}
              onRemoveColor={removeColor}
              mrp={mrp}
              onMrpChange={setMrp}
            />
          </Card>

          <Card title={t('catalog.quickCreate.stockSection')}>
            <OpeningStockSection
              sizes={effectiveSizes}
              colors={effectiveColors}
              quantities={quantities}
              onQuantityChange={(key, value) =>
                setQuantities((current) => ({ ...current, [key]: value }))
              }
              unitCost={unitCost}
              onUnitCostChange={setUnitCost}
              note={note}
              onNoteChange={setNote}
              branchName={branchName}
            />
          </Card>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full sm:w-auto"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending
              ? t('catalog.quickCreate.submitting')
              : t('catalog.quickCreate.submit')}
          </Button>
        </form>
      )}
    </main>
  );
}
