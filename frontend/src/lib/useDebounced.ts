import { useEffect, useState } from 'react';

export const SEARCH_DELAY_MS = 300;

/**
 * The trimmed text of a search box once typing pauses, so a search is sent per
 * word rather than per key. Emptying the box takes effect at once.
 */
export function useDebounced(text: string): string {
  const trimmed = text.trim();
  const [settled, setSettled] = useState(trimmed);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(trimmed), trimmed ? SEARCH_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [trimmed]);

  return trimmed ? settled : '';
}
