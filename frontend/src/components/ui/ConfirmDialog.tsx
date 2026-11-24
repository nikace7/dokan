import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface ConfirmDialogProps {
  /** The button that opens the question; leave out when `open` controls it. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  /** What will happen, including whether it can be undone. */
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  /** Figures to check before confirming. */
  children?: ReactNode;
}

/** The one "are you sure?" for actions that are hard to take back. */
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="group">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline">{t('common.goBack')}</Button>
          </DialogClose>
          <DialogClose asChild>
            {/* Dead while the dialog fades out, so a double tap acts once. */}
            <Button
              variant={danger ? 'danger' : 'primary'}
              className="group-data-[state=closed]:pointer-events-none"
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
