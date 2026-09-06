import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import type { ItemSalesRow } from '@/features/reports/api';
import { formatNpr, formatPaisa, useMoneyDisplay } from '@/lib/money';

const TOP_N = 10;
const MIN_CHART_HEIGHT = 260;
const ROW_HEIGHT = 42;
const CHART_VERTICAL_PADDING = 24;
const MAX_ITEM_LABEL_CHARS = 27;

type Metric = 'qty' | 'amount';

interface ChartRow {
  id: string;
  itemName: string;
  variantLabel: string;
  qty: number;
  amountPaisa: number;
}

interface AxisTickProps {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  rows: ChartRow[];
}

function truncateLabel(label: string): string {
  if (label.length <= MAX_ITEM_LABEL_CHARS) {
    return label;
  }
  return `${label.slice(0, MAX_ITEM_LABEL_CHARS - 1).trimEnd()}…`;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function ItemAxisTick({ x = 0, y = 0, payload, rows }: AxisTickProps) {
  const row = rows.find((candidate) => candidate.id === String(payload?.value));
  if (!row) {
    return null;
  }
  const accessibleLabel = `${row.itemName}, ${row.variantLabel}`;
  return (
    <g
      transform={`translate(${x},${y})`}
      aria-label={accessibleLabel}
      data-testid="item-chart-axis-label"
    >
      <text x={-10} textAnchor="end" fill="hsl(var(--foreground))" fontSize={11}>
        <tspan x={-10} dy="-0.25em" fontWeight={500}>
          {truncateLabel(row.itemName)}
        </tspan>
        <tspan x={-10} dy="1.35em" fill="hsl(var(--muted-foreground))" fontSize={10}>
          {row.variantLabel}
        </tspan>
      </text>
    </g>
  );
}

function ItemChartTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const row = payload?.[0]?.payload as ChartRow | undefined;
  const { t } = useTranslation();
  if (!active || !row) {
    return null;
  }
  return (
    <div className="max-w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
      <p className="text-pretty text-sm font-semibold">{row.itemName}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{row.variantLabel}</p>
      <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('reports.itemChart.qtySold')}</dt>
        <dd className="text-right font-medium tabular-nums">{formatQuantity(row.qty)}</dd>
        <dt className="text-muted-foreground">{t('reports.itemChart.amount')}</dt>
        <dd className="text-right font-medium tabular-nums">
          {formatNpr((row.amountPaisa / 100).toFixed(2))}
        </dd>
      </dl>
    </div>
  );
}

/**
 * Top-selling variants as a readable horizontal chart. Each row receives
 * enough height for a controlled item + size/colour label; the metric switch
 * and rich tooltip let the owner compare volume with revenue.
 */
export function ItemSalesChart({ rows }: { rows: ItemSalesRow[] }) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<Metric>('qty');
  useMoneyDisplay();
  const data: ChartRow[] = rows.slice(0, TOP_N).map((row) => ({
    id: row.variant_id,
    itemName: row.item_name,
    variantLabel: `${row.size} / ${row.color}`,
    qty: Number(row.qty),
    amountPaisa: Math.round(Number(row.amount) * 100),
  }));

  if (data.length === 0) {
    return null;
  }

  const chartHeight = Math.max(MIN_CHART_HEIGHT, data.length * ROW_HEIGHT + CHART_VERTICAL_PADDING);
  const dataKey = metric === 'qty' ? 'qty' : 'amountPaisa';
  const ariaLabel =
    metric === 'qty' ? t('reports.itemChart.aria') : t('reports.itemChart.ariaAmount');
  const formatMetric = (value: number) =>
    metric === 'qty'
      ? formatQuantity(value)
      : formatPaisa(value, { symbol: 'auto' }).replace(/\.00$/, '');

  return (
    <section className="mb-4 rounded-xl border bg-muted/20 p-3 sm:p-4 print:border-0 print:bg-transparent print:p-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="font-medium">{t('reports.itemChart.title')}</p>
          <p className="text-pretty text-xs text-muted-foreground">{t('reports.itemChart.hint')}</p>
        </div>
        <div role="group" aria-label={t('reports.itemChart.metricAria')} className="flex gap-1">
          <Button
            size="sm"
            variant={metric === 'qty' ? 'secondary' : 'ghost'}
            aria-pressed={metric === 'qty'}
            onClick={() => setMetric('qty')}
          >
            {t('reports.itemChart.quantity')}
          </Button>
          <Button
            size="sm"
            variant={metric === 'amount' ? 'secondary' : 'ghost'}
            aria-pressed={metric === 'amount'}
            onClick={() => setMetric('amount')}
          >
            {t('reports.itemChart.salesAmount')}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div
          role="img"
          aria-label={ariaLabel}
          className="min-w-[620px] w-full"
          style={{ height: chartHeight }}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 760, height: chartHeight }}
          >
            <BarChart
              data={data}
              layout="vertical"
              accessibilityLayer
              margin={{ top: 8, right: 96, bottom: 8, left: 8 }}
            >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => formatMetric(value)}
              />
              <YAxis
                type="category"
                dataKey="id"
                width={196}
                interval={0}
                tick={<ItemAxisTick rows={data} />}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={<ItemChartTooltip />}
                cursor={{ fill: 'hsl(var(--muted) / 0.55)' }}
                animationDuration={150}
              />
              <Bar
                dataKey={dataKey}
                fill="hsl(var(--primary))"
                radius={[0, 6, 6, 0]}
                maxBarSize={24}
                activeBar={{ fill: 'hsl(var(--primary) / 0.8)' }}
                background={{ fill: 'hsl(var(--muted) / 0.55)' }}
                animationDuration={300}
              >
                <LabelList
                  dataKey={dataKey}
                  position="right"
                  formatter={(value) => formatMetric(Number(value ?? 0))}
                  fill="hsl(var(--foreground))"
                  fontSize={11}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
