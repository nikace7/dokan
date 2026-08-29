import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';
import { hasPermission } from '@/lib/permissions';
import type { PermissionCodename } from '@/lib/permissions';
import { hasPlanFeature } from '@/lib/plans';
import type { PlanFeature } from '@/lib/plans';

interface ReportLink {
  to: string;
  titleKey: string;
  descriptionKey: string;
  /** Mirrors the backend GET permission for the report endpoint. */
  permission: PermissionCodename;
  feature?: PlanFeature;
}

const REPORTS: readonly ReportLink[] = [
  {
    to: '/reports/sales',
    titleKey: 'reports.links.sales.title',
    descriptionKey: 'reports.links.sales.description',
    permission: 'report.sales',
  },
  {
    to: '/reports/stock',
    titleKey: 'reports.links.stock.title',
    descriptionKey: 'reports.links.stock.description',
    permission: 'report.stock',
  },
  {
    to: '/reports/profit',
    titleKey: 'reports.links.profit.title',
    descriptionKey: 'reports.links.profit.description',
    permission: 'report.profit',
    feature: 'profit_reports',
  },
  {
    to: '/reports/dues',
    titleKey: 'reports.links.dues.title',
    descriptionKey: 'reports.links.dues.description',
    permission: 'report.ledger',
  },
  {
    to: '/reports/vat',
    titleKey: 'reports.links.vat.title',
    descriptionKey: 'reports.links.vat.description',
    permission: 'report.vat',
    feature: 'vat_module',
  },
];

/** Reports home — card grid into each report, filtered by permission + plan. */
export function ReportsHomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const visible = REPORTS.filter(
    (report) =>
      hasPermission(user, report.permission) &&
      (!report.feature || hasPlanFeature(user, report.feature)),
  );

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <h1 className="mb-4 text-xl font-semibold sm:text-2xl">{t('reports.title')}</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((report) => (
          <Link
            key={report.to}
            to={report.to}
            className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-shadow hover:shadow-md sm:p-5"
          >
            <h2 className="text-base font-semibold text-primary">{t(report.titleKey)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t(report.descriptionKey)}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
