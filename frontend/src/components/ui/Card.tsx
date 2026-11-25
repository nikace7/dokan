import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

import { usePageTitle } from '@/lib/usePageTitle';
import { cn } from '@/lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  /** `h1` when this card is the page itself; it then names the browser tab too. */
  titleAs?: 'h1' | 'h2';
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Surface container. Keeps the original `title`/`actions` convenience API;
 * new code can compose `CardHeader`/`CardTitle`/`CardContent` directly for
 * finer control.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { title, titleAs: Title = 'h2', actions, children, className, ...props },
  ref,
) {
  usePageTitle(Title === 'h1' ? title : undefined);
  return (
    <div
      ref={ref}
      className={cn('rounded-lg border bg-card text-card-foreground shadow-card', className)}
      {...props}
    >
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3">
          {title ? <Title className="text-base font-semibold">{title}</Title> : <span />}
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </div>
  );
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />;
  },
);

export const CardTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardTitle({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('font-semibold leading-none tracking-tight', className)}
        {...props}
      />
    );
  },
);

export const CardDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardDescription({ className, ...props }, ref) {
    return <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
  },
);

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />;
  },
);

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />;
  },
);
