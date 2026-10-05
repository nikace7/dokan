import { cn } from '@/lib/utils';

/** Same tint vocabulary as StatTile — segment colors read the `--tint-*` tokens. */
export type DonutTint = 'green' | 'blue' | 'amber' | 'rose' | 'violet';

const TINT_TEXT_CLASS: Record<DonutTint, string> = {
  green: 'text-tint-green-foreground',
  blue: 'text-tint-blue-foreground',
  amber: 'text-tint-amber-foreground',
  rose: 'text-tint-rose-foreground',
  violet: 'text-tint-violet-foreground',
};

const TINT_DOT_CLASS: Record<DonutTint, string> = {
  green: 'bg-tint-green-foreground',
  blue: 'bg-tint-blue-foreground',
  amber: 'bg-tint-amber-foreground',
  rose: 'bg-tint-rose-foreground',
  violet: 'bg-tint-violet-foreground',
};

export interface ProgressDonutDatum {
  label: string;
  /** Absolute value; percentages are computed against the sum of values. */
  value: number;
  tint?: DonutTint;
}

export interface ProgressDonutProps {
  data: ProgressDonutDatum[];
  /** Big center text; defaults to the largest segment's percentage. */
  centerValue?: string;
  /** Small muted text under the center value. */
  centerLabel?: string;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

const DEFAULT_TINTS: DonutTint[] = ['green', 'blue', 'amber', 'rose', 'violet'];
const STROKE_WIDTH = 14;

function formatPercent(value: number): string {
  return `${Number(value.toFixed(1))}%`;
}

/**
 * Accessible hand-rolled SVG donut with a center readout and a legend list
 * (colored dot + label + percentage). Use this for simple part-to-whole
 * breakdowns; reach for recharts (already a dependency) for line/bar charts.
 */
export function ProgressDonut({
  data,
  centerValue,
  centerLabel,
  size = 160,
  className,
}: ProgressDonutProps) {
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  const segments = data.map((d, i) => {
    const fraction = total > 0 ? Math.max(0, d.value) / total : 0;
    return { ...d, tint: d.tint ?? DEFAULT_TINTS[i % DEFAULT_TINTS.length], fraction };
  });
  const largest = segments.reduce(
    (best, s) => (s.fraction > (best?.fraction ?? -1) ? s : best),
    segments[0],
  );

  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = segments.map((s) => {
    const start = offset;
    offset += s.fraction;
    return { ...s, start };
  });

  const ariaLabel = segments.map((s) => `${s.label} ${formatPercent(s.fraction * 100)}`).join(', ');

  return (
    <div className={cn('flex flex-wrap items-center gap-5', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={ariaLabel}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={STROKE_WIDTH}
            className="stroke-muted"
          />
          {arcs.map((s) =>
            s.fraction > 0 ? (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="butt"
                strokeDasharray={`${s.fraction * circumference} ${circumference}`}
                strokeDashoffset={-s.start * circumference}
                className={TINT_TEXT_CLASS[s.tint]}
              />
            ) : null,
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-bold tracking-tight text-foreground">
            {centerValue ?? (largest ? formatPercent(largest.fraction * 100) : '—')}
          </span>
          {centerLabel ? (
            <span className="text-xs text-muted-foreground">{centerLabel}</span>
          ) : null}
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn('h-2.5 w-2.5 shrink-0 rounded-full', TINT_DOT_CLASS[s.tint])}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">
              {formatPercent(s.fraction * 100)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
