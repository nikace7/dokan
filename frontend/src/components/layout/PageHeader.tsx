import type { ReactNode } from 'react';

import { usePageTitle } from '@/lib/usePageTitle';
import { cn } from '@/lib/utils';

/**
 * Standard page top for tenant feature screens: title + optional description
 * on the left, actions on the right. One typographic decision everywhere —
 * screens lead with this or with a `Card title`, never a hand-rolled `<h1>`.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  usePageTitle(title);
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
