import { Toaster as SonnerToaster } from 'sonner';
import type { ComponentProps } from 'react';

type ToasterProps = ComponentProps<typeof SonnerToaster>;

/**
 * App-wide toast outlet, mounted once near the root. Trigger with
 * `toast('Saved')` / `toast.error(...)` from the `sonner` package.
 * POS counter screens should prefer inline state over toasts for anything
 * the cashier must act on (docs/SYSTEM_DESIGN.md §7.1).
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <SonnerToaster
      position="top-center"
      toastOptions={{
        classNames: {
          toast:
            'group border bg-background text-foreground shadow-lg rounded-md',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
export { toast } from 'sonner';
