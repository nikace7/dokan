import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Right-side header slot (filters, view links, export buttons). */
  actions?: ReactNode;
  /** The chart body (recharts line/bar, ProgressDonut, …). */
  children: ReactNode;
  className?: string;
  /** Override for the body wrapper (e.g. remove padding for flush charts). */
  contentClassName?: string;
}

/**
 * Consistent chart container: header row (title/subtitle + actions) and a
 * padded body. Keeps every report/dashboard chart on the same surface and
 * spacing so screens compose without per-chart card markup.
 */
export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
}: ChartCardProps) {
  return (
    <section className={cn('rounded-xl border bg-card shadow-card', className)}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-card-foreground">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn('p-5', contentClassName)}>{children}</div>
    </section>
  );
}
