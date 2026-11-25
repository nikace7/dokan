import { useEffect } from 'react';

const SITE_NAME = 'mero-pasal.online';

/** Names the browser tab after the screen, so several open tabs can be told apart. */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${SITE_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
