import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class lists, letting later Tailwind classes win over
 * earlier conflicting ones (e.g. a caller's `px-6` overrides a default
 * `px-4` instead of both ending up in the class attribute).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
