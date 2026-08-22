import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface ImageLightboxProps {
  /** The full-size image to show; null keeps the lightbox closed. */
  imageUrl: string | null;
  /** Accessible label for the dialog and the image. */
  alt: string;
  onClose: () => void;
}

/**
 * Full-screen photo preview (storefront-style). Dismisses on backdrop tap,
 * Escape, or the close button. Renders nothing while `imageUrl` is null.
 */
export function ImageLightbox({ imageUrl, alt, onClose }: ImageLightboxProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!imageUrl) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imageUrl, onClose]);

  if (!imageUrl) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <img
        src={imageUrl}
        alt={alt}
        className="max-h-[90vh] max-w-full rounded-lg bg-background object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label={t('common.close')}
        className="absolute right-4 top-4 rounded-full bg-background/90 p-2 text-foreground shadow transition-colors hover:bg-background"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
