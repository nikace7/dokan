import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { Label } from '@/components/ui/label';
import { ITEM_IMAGE_ACCEPT } from '@/features/catalog/api';
import { ItemImage } from '@/features/catalog/ui';

interface ItemImageFieldProps {
  hasInitial: boolean;
  itemName: string;
  imageUrl: string | null;
  pendingImage: File | null;
  imageError: string | null;
  busy: boolean;
  uploading: boolean;
  onSelect: (file: File | undefined) => void;
  onRemove: () => void;
  onClearPending: () => void;
}

export function ItemImageField({
  hasInitial,
  itemName,
  imageUrl,
  pendingImage,
  imageError,
  busy,
  uploading,
  onSelect,
  onRemove,
  onClearPending,
}: ItemImageFieldProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const alt = itemName.trim() || t('catalog.form.image');

  return (
    <div className="flex items-start gap-3 sm:col-span-2">
      {imageUrl ? (
        <button
          type="button"
          aria-label={t('catalog.photo.preview')}
          onClick={() => setPreviewOpen(true)}
          className="cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ItemImage imageUrl={imageUrl} alt={alt} className="h-20 w-20" />
        </button>
      ) : (
        <ItemImage imageUrl={null} alt={alt} className="h-20 w-20" />
      )}
      <ImageLightbox
        imageUrl={previewOpen ? imageUrl : null}
        alt={alt}
        onClose={() => setPreviewOpen(false)}
      />
      <div className="flex flex-col gap-1.5">
        <Label>{t('catalog.form.image')}</Label>
        <input
          ref={inputRef}
          type="file"
          accept={ITEM_IMAGE_ACCEPT}
          aria-label={t('catalog.form.image')}
          className="sr-only"
          onChange={(event) => {
            onSelect(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {uploading
              ? t('catalog.form.imageUploading')
              : imageUrl || pendingImage
                ? t('catalog.form.imageChange')
                : t('catalog.form.imageUpload')}
          </Button>
          {hasInitial && imageUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={busy}
              onClick={onRemove}
            >
              {t('catalog.form.imageRemove')}
            </Button>
          ) : null}
          {!hasInitial && pendingImage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={onClearPending}
            >
              {t('catalog.form.imageRemove')}
            </Button>
          ) : null}
        </div>
        {!hasInitial && pendingImage ? (
          <p className="text-xs text-muted-foreground">{pendingImage.name}</p>
        ) : null}
        {imageError ? (
          <p role="alert" className="text-sm text-destructive">
            {imageError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
