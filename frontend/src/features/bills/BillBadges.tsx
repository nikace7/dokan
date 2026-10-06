import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import type { BillSummary } from '@/features/bills/api';

const STATUS_VARIANTS: Partial<Record<string, 'success' | 'warning' | 'destructive'>> = {
  COMPLETED: 'success',
  HELD: 'warning',
  CANCELLED: 'destructive',
};

export function BillStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? 'secondary'}>
      {t(`bills.status.${status}`, { defaultValue: status })}
    </Badge>
  );
}

/** Ordinary sales carry no badge; returns and exchange bills are marked. */
export function DocTypeBadge({ docType }: { docType: string }) {
  const { t } = useTranslation();
  if (docType === 'SALE') return null;
  return (
    <Badge variant="outline">{t(`bills.docType.${docType}`, { defaultValue: docType })}</Badge>
  );
}

/** How the bill was paid; unpaid balance shows as credit (udharo). */
export function TenderBadges({ bill }: { bill: Pick<BillSummary, 'tenders' | 'due_amount'> }) {
  const { t } = useTranslation();
  const methods = [...new Set(bill.tenders.map((tender) => tender.method))];
  // A CREDIT tender already says so; only flag a due the tenders don't show.
  const hasDue = Number(bill.due_amount) > 0 && !methods.includes('CREDIT');
  return (
    <span className="inline-flex flex-wrap gap-1">
      {methods.map((method) => (
        <Badge key={method} variant="secondary">
          {method}
        </Badge>
      ))}
      {hasDue ? <Badge variant="outline">{t('bills.credit')}</Badge> : null}
    </span>
  );
}
