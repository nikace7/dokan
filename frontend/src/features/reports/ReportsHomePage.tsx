import { Link } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';
import { hasPlanFeature } from '@/lib/plans';
import type { PlanFeature } from '@/lib/plans';

interface ReportLink {
  to: string;
  title: string;
  description: string;
  feature?: PlanFeature;
}

const REPORTS: readonly ReportLink[] = [
  {
    to: '/reports/sales',
    title: 'Sales / बिक्री',
    description: 'Daily sales by BS date, monthly totals by fiscal year, and top-selling items.',
  },
  {
    to: '/reports/stock',
    title: 'Stock / स्टक',
    description: 'Stock summary with valuation, low-stock against reorder levels, and dead stock.',
  },
  {
    to: '/reports/profit',
    title: 'Profit / नाफा',
    description: 'Revenue, cost of goods, and gross profit by BS month. Owner only.',
    feature: 'profit_reports',
  },
  {
    to: '/reports/dues',
    title: 'Dues / उधारो',
    description: 'Customer udharo aging (0–30 / 31–60 / 61–90 / 90+ days) and supplier payables.',
  },
  {
    to: '/reports/vat',
    title: 'VAT register / भ्याट',
    description: 'IRD sales and purchase VAT registers by BS date range.',
    feature: 'vat_module',
  },
];

/** Reports home — card grid into each report. */
export function ReportsHomePage() {
  const { user } = useAuth();

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <h1 className="mb-4 text-xl font-semibold sm:text-2xl">Reports / प्रतिवेदन</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.filter((report) => !report.feature || hasPlanFeature(user, report.feature)).map(
          (report) => (
            <Link
              key={report.to}
              to={report.to}
              className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-shadow hover:shadow-md sm:p-5"
            >
              <h2 className="text-base font-semibold text-primary">{report.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{report.description}</p>
            </Link>
          ),
        )}
      </div>
    </main>
  );
}
