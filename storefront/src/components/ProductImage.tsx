import { useState } from 'react';

interface ProductImageProps {
  src: string | null;
  alt: string;
  className?: string;
  /** Classes for the fallback tile (initial letter) shown when no image. */
  fallbackClassName?: string;
  loading?: 'lazy' | 'eager';
}

/** Product photo with a graceful initial-letter fallback tile. */
export function ProductImage({
  src,
  alt,
  className,
  fallbackClassName,
  loading = 'lazy',
}: ProductImageProps) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    const initial = alt.trim().charAt(0).toUpperCase() || '·';
    return (
      <div className={fallbackClassName} role="img" aria-label={alt}>
        <span aria-hidden="true">{initial}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      onError={() => setBroken(true)}
      className={className}
    />
  );
}
