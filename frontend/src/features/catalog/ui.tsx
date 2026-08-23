/**
 * Native `<select>` styling on the design-system tokens — mirrors the Input
 * primitive so form rows line up. Kept as a plain class string because the
 * Radix select would change the option/keyboard semantics these screens
 * (and their tests) rely on.
 */

import { ImageIcon } from 'lucide-react';
import { useState } from 'react';

import { ITEM_IMAGE_ACCEPT, ITEM_IMAGE_MAX_BYTES } from '@/features/catalog/api';
import { cn } from '@/lib/utils';

export const selectClasses = [
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

/** Client-side check before upload; the backend enforces the same rules. */
export function itemImageError(file: File): 'type' | 'size' | null {
  if (!ITEM_IMAGE_ACCEPT.split(',').includes(file.type)) {
    return 'type';
  }
  if (file.size > ITEM_IMAGE_MAX_BYTES) {
    return 'size';
  }
  return null;
}

interface ItemImageProps {
  /** `/media/…` path from the API; null renders the placeholder tile. */
  imageUrl: string | null | undefined;
  /** Accessible name for the photo (item/variant name). */
  alt: string;
  className?: string;
}

/**
 * Small item-photo thumbnail used across catalog lists and the simple-sale
 * picker/line cards. Falls back to a neutral placeholder tile when the item
 * has no photo OR the file fails to load (deleted media, broken path) — a
 * broken-image icon must never reach the counter. Always `loading="lazy"` —
 * list screens render many rows.
 */
export function ItemImage({ imageUrl, alt, className }: ItemImageProps) {
  const [loadFailed, setLoadFailed] = useState(false);
  const classes = cn(
    'shrink-0 overflow-hidden rounded-md border border-border bg-muted',
    className,
  );
  if (!imageUrl || loadFailed) {
    return (
      <span className={cn(classes, 'flex items-center justify-center')} aria-hidden="true">
        <ImageIcon className="h-1/2 w-1/2 text-muted-foreground" />
      </span>
    );
  }
  return (
    <img
      src={imageUrl}
      alt={alt}
      loading="lazy"
      onError={() => setLoadFailed(true)}
      className={cn(classes, 'object-cover')}
    />
  );
}
