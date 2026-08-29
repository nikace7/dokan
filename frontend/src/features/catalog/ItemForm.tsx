import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import {
  createBrand,
  createCategory,
  createItem,
  createSizeChart,
  ITEM_IMAGE_ACCEPT,
  listBrands,
  listCategories,
  listSizeCharts,
  removeItemImage,
  updateItem,
  uploadItemImage,
} from '@/features/catalog/api';
import type { Gender, Item, ItemPayload } from '@/features/catalog/api';
import { QuickAddSelect } from '@/features/catalog/QuickAddSelect';
import { itemImageError, ItemImage, selectClasses } from '@/features/catalog/ui';
import { ApiError } from '@/lib/api/client';

const GENDERS: Array<{ id: Gender; labelKey: string }> = [
  { id: 'M', labelKey: 'catalog.form.genderOptions.men' },
  { id: 'F', labelKey: 'catalog.form.genderOptions.women' },
  { id: 'U', labelKey: 'catalog.form.genderOptions.unisex' },
  { id: 'KIDS', labelKey: 'catalog.form.genderOptions.kids' },
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
  const { t } = useTranslation();
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
  const [websitePrice, setWebsitePrice] = useState(initial?.website_price ?? '');
  const [websiteDiscount, setWebsiteDiscount] = useState(initial?.website_discount_pct ?? '');
  const [websiteVisible, setWebsiteVisible] = useState(initial?.website_visible ?? true);
  const [websiteFeatured, setWebsiteFeatured] = useState(initial?.website_featured ?? false);
  const [reorderLevel, setReorderLevel] = useState(initial?.reorder_level ?? '');
  const [error, setError] = useState<string | null>(null);
  // Item photo: edit uploads immediately on select; create stashes the file
  // and uploads right after the item exists.
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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
    onSuccess: async (item) => {
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'items'] });
      if (!initial && pendingImage) {
        try {
          onSaved(await uploadItemImage(item.id, pendingImage));
          return;
        } catch {
          // The item exists; the photo can be retried from the edit screen.
        }
      }
      onSaved(item);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('catalog.form.saveError')),
  });

  const uploadImageMutation = useMutation({
    mutationFn: (file: File) => uploadItemImage(initial?.id ?? '', file),
    onSuccess: (item) => {
      setImageUrl(item.image_url ?? null);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'items'] });
    },
    onError: (err) =>
      setImageError(err instanceof ApiError ? err.message : t('catalog.form.imageUploadError')),
  });

  const removeImageMutation = useMutation({
    mutationFn: () => removeItemImage(initial?.id ?? ''),
    onSuccess: (item) => {
      setImageUrl(item?.image_url ?? null);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'items'] });
    },
    onError: (err) =>
      setImageError(err instanceof ApiError ? err.message : t('catalog.form.imageUploadError')),
  });

  const imageBusy = uploadImageMutation.isPending || removeImageMutation.isPending;

  const onImageSelected = (file: File | undefined) => {
    if (!file) {
      return;
    }
    const problem = itemImageError(file);
    if (problem) {
      setImageError(
        t(problem === 'type' ? 'catalog.form.imageInvalidType' : 'catalog.form.imageTooLarge'),
      );
      return;
    }
    setImageError(null);
    if (initial) {
      uploadImageMutation.mutate(file);
    } else {
      setPendingImage(file);
    }
  };

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
      website_price: blankToNull(websitePrice),
      website_discount_pct: blankToNull(websiteDiscount),
      website_visible: websiteVisible,
      website_featured: websiteFeatured,
      reorder_level: blankToNull(reorderLevel),
    });
  };

  const refreshTaxonomies = () =>
    queryClient.invalidateQueries({ queryKey: ['catalog', 'taxonomies'] });

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="flex items-start gap-3 sm:col-span-2">
        {imageUrl ? (
          <button
            type="button"
            aria-label={t('catalog.photo.preview')}
            onClick={() => setPreviewOpen(true)}
            className="cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ItemImage
              imageUrl={imageUrl}
              alt={name.trim() || t('catalog.form.image')}
              className="h-20 w-20"
            />
          </button>
        ) : (
          <ItemImage
            imageUrl={null}
            alt={name.trim() || t('catalog.form.image')}
            className="h-20 w-20"
          />
        )}
        <ImageLightbox
          imageUrl={previewOpen ? imageUrl : null}
          alt={name.trim() || t('catalog.form.image')}
          onClose={() => setPreviewOpen(false)}
        />
        <div className="flex flex-col gap-1.5">
          <Label>{t('catalog.form.image')}</Label>
          <input
            ref={imageInputRef}
            type="file"
            accept={ITEM_IMAGE_ACCEPT}
            aria-label={t('catalog.form.image')}
            className="sr-only"
            onChange={(e) => {
              onImageSelected(e.target.files?.[0]);
              // Allow picking the same file again after a failed attempt.
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={imageBusy}
              onClick={() => imageInputRef.current?.click()}
            >
              {uploadImageMutation.isPending
                ? t('catalog.form.imageUploading')
                : imageUrl || pendingImage
                  ? t('catalog.form.imageChange')
                  : t('catalog.form.imageUpload')}
            </Button>
            {initial && imageUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={imageBusy}
                onClick={() => removeImageMutation.mutate()}
              >
                {t('catalog.form.imageRemove')}
              </Button>
            ) : null}
            {!initial && pendingImage ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => setPendingImage(null)}
              >
                {t('catalog.form.imageRemove')}
              </Button>
            ) : null}
          </div>
          {!initial && pendingImage ? (
            <p className="text-xs text-muted-foreground">{pendingImage.name}</p>
          ) : null}
          {imageError ? (
            <p role="alert" className="text-sm text-destructive">
              {imageError}
            </p>
          ) : null}
        </div>
      </div>

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
      <Input
        label={t('catalog.form.nameNp')}
        value={nameNp}
        onChange={(e) => setNameNp(e.target.value)}
      />
      <Input
        label={t('catalog.form.unit')}
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
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
      <QuickAddSelect
        label={t('catalog.form.brand')}
        options={taxonomies.data?.brands ?? []}
        value={brand}
        onChange={setBrand}
        addLabel={t('catalog.form.quickAdd')}
        onCreate={async (brandName) => {
          const created = await createBrand({ name: brandName });
          await refreshTaxonomies();
          return created;
        }}
      />
      <QuickAddSelect
        label={t('catalog.form.sizeChart')}
        options={taxonomies.data?.sizeCharts ?? []}
        value={sizeChart}
        onChange={setSizeChart}
        addLabel={t('catalog.form.quickAdd')}
        extraField={{ label: t('catalog.form.sizeValues'), placeholder: 'S, M, L, XL' }}
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gender">{t('catalog.form.gender')}</Label>
        <select
          id="gender"
          value={gender}
          onChange={(e) => setGender(e.target.value as Gender | '')}
          className={selectClasses}
        >
          <option value="">{t('catalog.form.none')}</option>
          {GENDERS.map((g) => (
            <option key={g.id} value={g.id}>
              {t(g.labelKey)}
            </option>
          ))}
        </select>
      </div>

      <Input
        label={t('catalog.form.season')}
        value={season}
        onChange={(e) => setSeason(e.target.value)}
      />
      <Input
        label={t('catalog.form.collectionTag')}
        value={collectionTag}
        onChange={(e) => setCollectionTag(e.target.value)}
      />
      <Input
        label={t('catalog.form.hsnCode')}
        value={hsnCode}
        onChange={(e) => setHsnCode(e.target.value)}
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
      <Input
        label={t('catalog.form.websitePrice')}
        value={websitePrice}
        onChange={(e) => setWebsitePrice(e.target.value)}
        inputMode="decimal"
      />
      <Input
        label={t('catalog.form.websiteDiscount')}
        value={websiteDiscount}
        onChange={(e) => setWebsiteDiscount(e.target.value)}
        inputMode="decimal"
      />
      <Input
        label={t('catalog.form.reorderLevel')}
        value={reorderLevel}
        onChange={(e) => setReorderLevel(e.target.value)}
        inputMode="decimal"
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 self-end pb-2 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={websiteVisible}
            onChange={(e) => setWebsiteVisible(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {t('catalog.form.websiteVisible')}
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={websiteFeatured}
            onChange={(e) => setWebsiteFeatured(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {t('catalog.form.websiteFeatured')}
        </label>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">
        {t('catalog.form.websiteHelp')}
      </p>

      <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={isVatApplicable}
          onChange={(e) => setIsVatApplicable(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        {t('catalog.form.vatApplicable')}
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2"
        >
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" size="lg" disabled={saveMutation.isPending}>
          {saveMutation.isPending
            ? t('catalog.form.saving')
            : initial
              ? t('catalog.form.saveChanges')
              : t('catalog.form.create')}
        </Button>
      </div>
    </form>
  );
}
