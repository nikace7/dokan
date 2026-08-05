import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { getSale, listHeldBills } from '@/features/billing/api';
import type { SalesInvoice } from '@/features/billing/api';
import { formatNpr, toPaisa } from '@/lib/money';
import { useCartStore } from '@/stores/cartStore';

/**
 * Parked bills. Resume loads the held bill's lines back into the cart;
 * completing then tenders the SAME invoice (POST /sales/<id>/complete), so
 * no stock or numbering moves twice.
 */
export function HeldBillsPanel() {
  const resumeHeld = useCartStore((s) => s.resumeHeld);
  const currentHeldId = useCartStore((s) => s.heldSaleId);

  const query = useQuery({
    queryKey: ['sales', 'held'],
    queryFn: listHeldBills,
  });

  const resume = async (id: string) => {
    const invoice: SalesInvoice = await getSale(id);
    resumeHeld(
      invoice.id,
      invoice.items.map((item) => ({
        variantId: item.variant,
        sku: item.variant_sku,
        label: item.item_name,
        quantity: Number(item.qty),
        unitPricePaisa: toPaisa(item.unit_price),
        discountPaisa: toPaisa(item.discount),
      })),
      invoice.customer && invoice.customer_name
        ? { id: invoice.customer, name: invoice.customer_name, phone: '' }
        : null,
    );
  };

  const held = (query.data ?? []).filter((invoice) => invoice.id !== currentHeldId);
  if (held.length === 0) {
    return null;
  }

  return (
    <Card title="Held bills / रोकिएका बिल" className="mt-4">
      <ul className="space-y-2">
        {held.map((invoice) => (
          <li key={invoice.id} className="flex items-center justify-between gap-2 text-sm">
            <div>
              <span className="font-medium">{invoice.customer_name ?? 'Walk-in'}</span>{' '}
              <span className="text-slate-500">{formatNpr(invoice.total)}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void resume(invoice.id)}>
              Resume
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
