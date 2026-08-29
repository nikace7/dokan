import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { QuickViewModal } from './QuickViewModal';
import type { StorePopup } from '../lib/api';

interface OfferPopupProps {
  /** Null (or copy-less) popups never render. */
  popup: StorePopup | null;
  /** Template-specific frame classes (backdrop + panel). */
  backdropClassName: string;
  panelClassName: string;
  /** Templates own the visuals; the render prop receives the close action. */
  children: (close: () => void) => ReactNode;
}

function storageKey(popup: StorePopup): string {
  // Keyed by content so an edited offer re-appears for returning visitors.
  return `mp-popup-seen:${popup.title}|${popup.text}`;
}

function alreadySeen(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false; // storage blocked (private mode) — treat as unseen, never crash
  }
}

/**
 * The tenant's offer popup: shown once per visitor session, a beat after
 * load so it doesn't fight the hero. Reuses the quick-view modal's focus,
 * Escape, and scroll-lock wiring; templates skin it through class props.
 */
export function OfferPopup({
  popup,
  backdropClassName,
  panelClassName,
  children,
}: OfferPopupProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!popup || (!popup.title && !popup.text)) {
      return;
    }
    if (alreadySeen(storageKey(popup))) {
      return;
    }
    const timer = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(timer);
  }, [popup]);

  if (!popup) {
    return null;
  }

  const close = () => {
    try {
      sessionStorage.setItem(storageKey(popup), '1');
    } catch {
      // storage blocked — the popup simply re-appears next load
    }
    setOpen(false);
  };

  return (
    <QuickViewModal
      open={open}
      onClose={close}
      label={popup.title || 'Store offer'}
      backdropClassName={backdropClassName}
      panelClassName={panelClassName}
    >
      {children(close)}
    </QuickViewModal>
  );
}
