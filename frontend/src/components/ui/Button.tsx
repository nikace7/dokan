import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium',
    'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    // Physical press feedback — the tap shrinks a touch, like native controls.
    'motion-safe:active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        // `primary` is the original API name; `default` is the shadcn one.
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow',
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        danger: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 rounded-md px-3 text-xs',
        default: 'h-9 px-4 py-2 text-sm',
        md: 'h-9 px-4 py-2 text-sm',
        // Counter hardware often means touch + distance: keep `lg` generously
        // sized (44px+ touch target, docs/SYSTEM_DESIGN.md §7.1).
        lg: 'h-11 rounded-md px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    'primary' | 'default' | 'secondary' | 'outline' | 'danger' | 'destructive' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg' | 'default' | 'icon';
  asChild?: boolean;
  /** Shows a spinner, marks the control busy, and blocks further presses. */
  loading?: boolean;
}

/**
 * Base button. Accepts both the original variant/size names (`primary`,
 * `danger`, `md`) and the shadcn-style aliases (`default`, `destructive`),
 * so existing feature screens keep working while new code uses the
 * design-system vocabulary. `loading` replaces hand-rolled "Saving…" labels:
 * the label stays put and a spinner appears beside it.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    asChild = false,
    type = 'button',
    loading = false,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  // Slot (asChild) demands exactly one child — never add the spinner beside it.
  const content =
    loading && !asChild ? (
      <>
        <Loader2 className="animate-spin" aria-hidden="true" />
        {children}
      </>
    ) : (
      children
    );
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {content}
    </Comp>
  );
});

export { buttonVariants };
