import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/Card';
import type { DashboardSalesDay } from '@/features/dashboard/api';
import { formatNpr, toPaisa } from '@/lib/money';

function money(value: string): string {
  return formatNpr(value).replace(/\.00$/, '');
}

/** Compact axis amount: 1.2K / 3.4L style is ambiguous in Nepal — use rupees. */
function axisMoney(paisa: number): string {
  const rupees = paisa / 100;
  if (rupees >= 100000) {
    return `${(rupees / 100000).toFixed(rupees % 100000 === 0 ? 0 : 1)}L`;
  }
  if (rupees >= 1000) {
    return `${(rupees / 1000).toFixed(rupees % 1000 === 0 ? 0 : 1)}K`;
  }
  return String(rupees);
}

interface TrendPoint {
  date: string;
  paisa: number;
}

/**
 * 30-day net-sales trend. BS dates come straight from the API (presentation
 * only — invariant 9); amounts are converted to integer paisa for the chart.
 */
export function SalesTrendChart({ rows }: { rows: DashboardSalesDay[] }) {
  const { t } = useTranslation();
  const points: TrendPoint[] = rows.map((row) => ({
    date: row.business_date_bs,
    paisa: toPaisa(row.net_total),
  }));

  return (
    <Card title={t('dashboard.trend.title')}>
      {points.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('dashboard.trend.empty')}
        </p>
      ) : (
        <div
          role="img"
          aria-label={t('dashboard.trend.title')}
          className="h-48 w-full sm:h-56"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
                tickFormatter={(date: string) => date.slice(5)}
              />
              <YAxis
                width={44}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={axisMoney}
              />
              <Tooltip
                formatter={(value) => [
                  money(String((Number(value) / 100).toFixed(2))),
                  t('dashboard.trend.netSales'),
                ]}
                labelFormatter={(date) => `BS ${String(date)}`}
              />
              <Area
                type="monotone"
                dataKey="paisa"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary) / 0.15)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
