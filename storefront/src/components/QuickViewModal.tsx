import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface QuickViewModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog (usually the product name). */
  label: string;
  /** Template-specific frame classes (backdrop + panel). */
  backdropClassName: string;
  panelClassName: string;
  children: ReactNode;
}

/**
 * Headless quick-view modal: backdrop click + Escape close, focus capture on
 * open and focus return on close, scroll lock, aria-modal wiring. Templates
 * own the visuals through the class props.
 */
export function QuickViewModal({
  open,
  onClose,
  label,
  backdropClassName,
  panelClassName,
  children,
}: QuickViewModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the panel so Escape and screen-reader flow start inside.
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={backdropClassName}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  );
}
