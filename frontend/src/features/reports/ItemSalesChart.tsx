import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';

import type { ItemSalesRow } from '@/features/reports/api';
import { formatNpr } from '@/lib/money';

const TOP_N = 10;

interface ChartRow {
  name: string;
  qty: number;
  amountPaisa: number;
}

/**
 * Top-selling variants (already sorted by qty desc server-side) as a
 * horizontal bar chart — the fastest answer to "what stock sold".
 */
export function ItemSalesChart({ rows }: { rows: ItemSalesRow[] }) {
  const { t } = useTranslation();
  const data: ChartRow[] = rows.slice(0, TOP_N).map((row) => ({
    name: `${row.item_name} (${row.size}/${row.color})`,
    qty: Number(row.qty),
    amountPaisa: Math.round(Number(row.amount) * 100),
  }));

  if (data.length === 0) {
    return null;
  }

  return (
    <div
      role="img"
      aria-label={t('reports.itemChart.aria')}
      className="mb-4 h-64 w-full"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
          <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value, name) =>
              name === 'qty'
                ? [String(value), t('reports.itemChart.qtySold')]
                : [formatNpr((Number(value) / 100).toFixed(2)), t('reports.itemChart.amount')]
            }
          />
          <Bar dataKey="qty" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
