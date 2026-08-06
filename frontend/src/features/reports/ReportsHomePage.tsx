import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';
import { hasPlanFeature } from '@/lib/plans';
import type { PlanFeature } from '@/lib/plans';

interface ReportLink {
  to: string;
  titleKey: string;
  descriptionKey: string;
  feature?: PlanFeature;
}

const REPORTS: readonly ReportLink[] = [
  {
    to: '/reports/sales',
    titleKey: 'reports.links.sales.title',
    descriptionKey: 'reports.links.sales.description',
  },
  {
    to: '/reports/stock',
    titleKey: 'reports.links.stock.title',
    descriptionKey: 'reports.links.stock.description',
  },
  {
    to: '/reports/profit',
    titleKey: 'reports.links.profit.title',
    descriptionKey: 'reports.links.profit.description',
    feature: 'profit_reports',
  },
  {
    to: '/reports/dues',
    titleKey: 'reports.links.dues.title',
    descriptionKey: 'reports.links.dues.description',
  },
  {
    to: '/reports/vat',
    titleKey: 'reports.links.vat.title',
    descriptionKey: 'reports.links.vat.description',
    feature: 'vat_module',
  },
];

/** Reports home — card grid into each report. */
export function ReportsHomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <h1 className="mb-4 text-xl font-semibold sm:text-2xl">{t('reports.title')}</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.filter((report) => !report.feature || hasPlanFeature(user, report.feature)).map(
          (report) => (
            <Link
              key={report.to}
              to={report.to}
              className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-shadow hover:shadow-md sm:p-5"
            >
              <h2 className="text-base font-semibold text-primary">{t(report.titleKey)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t(report.descriptionKey)}</p>
            </Link>
          ),
        )}
      </div>
    </main>
  );
}
