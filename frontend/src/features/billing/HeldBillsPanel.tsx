import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { listHeldBills } from '@/features/billing/api';
import { useResumeHeldBill } from '@/features/billing/useResumeHeldBill';
import { formatNpr, useMoneyDisplay } from '@/lib/money';
import { useCartStore } from '@/stores/cartStore';

/**
 * Parked bills. Resume loads the held bill's lines back into the cart;
 * completing then tenders the SAME invoice (POST /sales/<id>/complete), so
 * no stock or numbering moves twice.
 */
export function HeldBillsPanel() {
  const { t } = useTranslation();
  const { resume, isBusy, notice } = useResumeHeldBill();
  const currentHeldId = useCartStore((s) => s.heldSaleId);
  useMoneyDisplay();

  const query = useQuery({
    queryKey: ['sales', 'held'],
    queryFn: listHeldBills,
  });

  const held = (query.data ?? []).filter((invoice) => invoice.id !== currentHeldId);
  if (held.length === 0) {
    return null;
  }

  return (
    <Card title={t('billing.heldBills')} className="mt-4">
      <ul className="space-y-2">
        {held.map((invoice) => (
          <li key={invoice.id} className="flex items-center justify-between gap-2 text-sm">
            <div>
              <span className="font-medium">{invoice.customer_name ?? t('billing.walkIn')}</span>{' '}
              <span className="text-slate-500">{formatNpr(invoice.total)}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={isBusy}
              onClick={() => resume(invoice.id)}
            >
              {t('billing.resume')}
            </Button>
          </li>
        ))}
      </ul>
      {notice}
    </Card>
  );
}
