import { cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import type { Paisa } from '@/lib/money';
import { formatPaisa, useMoneyDisplay } from '@/lib/money';
import { cn } from '@/lib/utils';

/** Pastel icon-chip tints — one per `--tint-*` pair in styles/tokens.css. */
export type StatTileTint = 'green' | 'blue' | 'amber' | 'rose' | 'violet';

const chipVariants = cva(
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5',
  {
    variants: {
      tint: {
        green: 'bg-tint-green text-tint-green-foreground',
        blue: 'bg-tint-blue text-tint-blue-foreground',
        amber: 'bg-tint-amber text-tint-amber-foreground',
        rose: 'bg-tint-rose text-tint-rose-foreground',
        violet: 'bg-tint-violet text-tint-violet-foreground',
      },
    },
    defaultVariants: { tint: 'green' },
  },
);

export interface StatTileTrend {
  /**
   * Signed percent change vs the previous period. Positive renders a green
   * `▲` badge, negative a red `▼` badge, zero a neutral badge.
   */
  percent: number;
  /** Small caption after the badge, e.g. "vs last month". */
  label?: string;
}

export interface StatTileProps {
  /** Small-caps label above the value. */
  label: string;
  /** Pre-formatted text value. Mutually exclusive with `valuePaisa`. */
  value?: string;
  /** Money value in integer paisa — formatted via lib/money (रू prefix). */
  valuePaisa?: Paisa;
  icon: LucideIcon;
  tint?: StatTileTint;
  trend?: StatTileTrend;
  /** Footer caption line (muted, e.g. "12 bills"). */
  caption?: string;
  /** Skeleton loading state — renders no data. */
  isLoading?: boolean;
  className?: string;
}

function TrendBadge({ trend }: { trend: StatTileTrend }) {
  const direction = trend.percent > 0 ? 'up' : trend.percent < 0 ? 'down' : 'flat';
  const percent = Number(Math.abs(trend.percent).toFixed(1));
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold',
          direction === 'up' && 'bg-tint-green text-tint-green-foreground',
          direction === 'down' && 'bg-tint-rose text-tint-rose-foreground',
          direction === 'flat' && 'bg-muted text-muted-foreground',
        )}
      >
        {direction === 'up' ? '▲' : direction === 'down' ? '▼' : null}
        {percent}%
      </span>
      {trend.label ? <span className="text-muted-foreground">{trend.label}</span> : null}
    </span>
  );
}

/**
 * Dashboard stat tile: pastel icon chip, small-caps label, big bold value,
 * optional trend badge and footer caption. Compose on a grid; the tile is a
 * plain surface (`shadow-card`), not an interactive element.
 */
export function StatTile({
  label,
  value,
  valuePaisa,
  icon: Icon,
  tint = 'green',
  trend,
  caption,
  isLoading = false,
  className,
}: StatTileProps) {
  useMoneyDisplay();
  if (isLoading) {
    return (
      <div
        className={cn('rounded-xl border bg-card p-4 shadow-card', className)}
        aria-busy="true"
        aria-label={label}
      >
        <div className="flex items-start justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
        <Skeleton className="mt-2 h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-24" />
      </div>
    );
  }

  const displayValue =
    valuePaisa !== undefined ? formatPaisa(valuePaisa, { symbol: 'auto' }) : value;

  return (
    <div className={cn('rounded-xl border bg-card p-4 shadow-card', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={chipVariants({ tint })}>
          <Icon />
        </span>
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{displayValue}</p>
      {trend ? (
        <div className="mt-2">
          <TrendBadge trend={trend} />
        </div>
      ) : null}
      {caption ? <p className="mt-2 text-xs text-muted-foreground">{caption}</p> : null}
    </div>
  );
}
