/**
 * Product-section pieces of the quick-add page: the photo picker (stashes
 * the File for a post-create upload) and the collapsed "More details" grid.
 */
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { ITEM_IMAGE_ACCEPT } from '@/features/catalog/api';
import type { Brand } from '@/features/catalog/api';
import { QuickAddSelect } from '@/features/catalog/QuickAddSelect';
import { itemImageError, ItemImage, selectClasses } from '@/features/catalog/ui';

/** Optional item fields hidden behind the "More details" toggle. */
export interface DetailsState {
  nameNp: string;
  brand: string;
  gender: string;
  season: string;
  collectionTag: string;
  hsnCode: string;
  unit: string;
  isVatApplicable: boolean;
}

export const EMPTY_DETAILS: DetailsState = {
  nameNp: '',
  brand: '',
  gender: '',
  season: '',
  collectionTag: '',
  hsnCode: '',
  unit: 'PCS',
  isVatApplicable: false,
};

interface PhotoPickerProps {
  altName: string;
  pendingImage: File | null;
  imageError: string | null;
  onImageError: (message: string | null) => void;
  onSelected: (file: File) => void;
  onClear: () => void;
}

/** Photo picker for CREATE: validates and stashes the file; upload happens post-create. */
export function PhotoPicker({
  altName,
  pendingImage,
  imageError,
  onImageError,
  onSelected,
  onClear,
}: PhotoPickerProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const problem = itemImageError(file);
    if (problem) {
      onImageError(
        t(problem === 'type' ? 'catalog.form.imageInvalidType' : 'catalog.form.imageTooLarge'),
      );
      return;
    }
    onImageError(null);
    onSelected(file);
  };

  return (
    <div className="flex items-start gap-3 sm:col-span-2">
      <ItemImage imageUrl={null} alt={altName} className="h-20 w-20" />
      <div className="flex flex-col gap-1.5">
        <Label>{t('catalog.form.image')}</Label>
        <input
          ref={inputRef}
          type="file"
          accept={ITEM_IMAGE_ACCEPT}
          aria-label={t('catalog.form.image')}
          className="sr-only"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            // Allow picking the same file again after a failed attempt.
            e.target.value = '';
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            {pendingImage ? t('catalog.form.imageChange') : t('catalog.form.imageUpload')}
          </Button>
          {pendingImage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={onClear}
            >
              {t('catalog.form.imageRemove')}
            </Button>
          ) : null}
        </div>
        {pendingImage ? <p className="text-xs text-muted-foreground">{pendingImage.name}</p> : null}
        {imageError ? (
          <p role="alert" className="text-sm text-destructive">
            {imageError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface MoreDetailsSectionProps {
  details: DetailsState;
  onChange: (patch: Partial<DetailsState>) => void;
  expanded: boolean;
  onToggle: () => void;
  brands: Brand[];
  onCreateBrand: (name: string) => Promise<Brand>;
}

/** Collapsed-by-default grid of optional item fields (same set as ItemForm). */
export function MoreDetailsSection({
  details,
  onChange,
  expanded,
  onToggle,
  brands,
  onCreateBrand,
}: MoreDetailsSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        className="mt-4 flex items-center gap-1 text-sm font-medium text-primary"
        onClick={onToggle}
      >
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {t('catalog.quickCreate.moreDetails')}
      </button>
      {expanded ? (
        <div className="mt-3 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <Input
            label={t('catalog.form.nameNp')}
            value={details.nameNp}
            onChange={(e) => onChange({ nameNp: e.target.value })}
          />
          <QuickAddSelect
            label={t('catalog.form.brand')}
            options={brands}
            value={details.brand}
            onChange={(brand) => onChange({ brand })}
            addLabel={t('catalog.form.quickAdd')}
            onCreate={onCreateBrand}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quick-add-gender">{t('catalog.form.gender')}</Label>
            <select
              id="quick-add-gender"
              value={details.gender}
              onChange={(e) => onChange({ gender: e.target.value })}
              className={selectClasses}
            >
              <option value="">{t('catalog.form.none')}</option>
              <option value="M">{t('catalog.form.genderOptions.men')}</option>
              <option value="F">{t('catalog.form.genderOptions.women')}</option>
              <option value="U">{t('catalog.form.genderOptions.unisex')}</option>
              <option value="KIDS">{t('catalog.form.genderOptions.kids')}</option>
            </select>
          </div>
          <Input
            label={t('catalog.form.season')}
            value={details.season}
            onChange={(e) => onChange({ season: e.target.value })}
          />
          <Input
            label={t('catalog.form.collectionTag')}
            value={details.collectionTag}
            onChange={(e) => onChange({ collectionTag: e.target.value })}
          />
          <Input
            label={t('catalog.form.hsnCode')}
            value={details.hsnCode}
            onChange={(e) => onChange({ hsnCode: e.target.value })}
          />
          <Input
            label={t('catalog.form.unit')}
            value={details.unit}
            onChange={(e) => onChange({ unit: e.target.value })}
          />
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={details.isVatApplicable}
              onChange={(e) => onChange({ isVatApplicable: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            {t('catalog.form.vatApplicable')}
          </label>
        </div>
      ) : null}
    </>
  );
}
