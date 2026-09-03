import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/features/auth/useAuth';
import { getSale } from '@/features/billing/api';
import {
  advanceOnlineOrder,
  cancelOnlineOrder,
  listOnlineOrders,
  prepareOnlineOrder,
} from '@/features/storefrontOrders/api';
import type { OnlineOrder, OnlineOrderStatus } from '@/features/storefrontOrders/api';
import { ApiError } from '@/lib/api/client';
import { toPaisa } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';
import { useCartStore } from '@/stores/cartStore';

const STATUS_VARIANTS: Record<
  OnlineOrderStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  PLACED: 'warning',
  CONFIRMED: 'default',
  PACKED: 'default',
  SHIPPED: 'secondary',
  DELIVERED: 'success',
  CANCELLED: 'destructive',
};

const STATUS_KEYS: Record<OnlineOrderStatus, string> = {
  PLACED: 'onlineOrders.status.placed',
  CONFIRMED: 'onlineOrders.status.confirmed',
  PACKED: 'onlineOrders.status.packed',
  SHIPPED: 'onlineOrders.status.shipped',
  DELIVERED: 'onlineOrders.status.delivered',
  CANCELLED: 'onlineOrders.status.cancelled',
};

function nextAction(status: OnlineOrderStatus): string | null {
  if (status === 'CONFIRMED') return 'onlineOrders.markPacked';
  if (status === 'PACKED') return 'onlineOrders.markShipped';
  if (status === 'SHIPPED') return 'onlineOrders.markDelivered';
  return null;
}

function OrderCard({ order }: { order: OnlineOrder }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const resumeHeld = useCartStore((state) => state.resumeHeld);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['storefront', 'orders'] });
  const action = useMutation({
    mutationFn: (kind: 'prepare' | 'advance' | 'cancel') => {
      if (kind === 'prepare') return prepareOnlineOrder(order.id);
      if (kind === 'advance') return advanceOnlineOrder(order.id);
      return cancelOnlineOrder(order.id);
    },
    onSuccess: () => {
      setError(null);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['sales', 'held'] });
    },
    onError: (reason) =>
      setError(reason instanceof ApiError ? reason.message : t('onlineOrders.updateError')),
  });

  const openHeldBill = async () => {
    if (!order.sales_invoice) return;
    setError(null);
    try {
      const invoice = await getSale(order.sales_invoice.id);
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
      navigate('/billing');
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('onlineOrders.openError'));
    }
  };

  const canCreate = hasPermission(user, 'sale.create');
  const canCancel = hasPermission(user, 'sale.void');
  const advanceLabel = nextAction(order.status);
  const deliveryBlocked = order.status === 'SHIPPED' && order.sales_invoice?.status !== 'COMPLETED';

  return (
    <Card
      role="article"
      aria-label={`${order.number_text} · ${order.customer.email}`}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{order.number_text}</h2>
            <Badge variant={STATUS_VARIANTS[order.status]}>{t(STATUS_KEYS[order.status])}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.customer.full_name || order.customer.email} · {order.customer.phone || order.customer.email}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {order.fulfillment === 'PICKUP'
              ? t('onlineOrders.pickup')
              : t('onlineOrders.delivery')}{' '}
            · {order.branch.name} · {t('onlineOrders.bsDate', { date: order.business_date_bs })}
          </p>
        </div>
        <p className="font-semibold tabular-nums">{order.currency} {order.total}</p>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border px-3">
        {order.items.map((item, index) => (
          <li key={`${item.name}-${item.size}-${item.color}-${index}`} className="flex justify-between gap-3 py-2 text-sm">
            <span>{item.name} · {item.size}/{item.color} × {Number(item.qty)}</span>
            <span className="tabular-nums">{order.currency} {item.line_total}</span>
          </li>
        ))}
      </ul>
      {order.note ? (
        <p className="text-sm text-muted-foreground">
          {t('onlineOrders.note')}: {order.note}
        </p>
      ) : null}
      {deliveryBlocked ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          {t('onlineOrders.completeBillFirst')}
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {order.status === 'PLACED' && canCreate ? <Button loading={action.isPending} onClick={() => action.mutate('prepare')}>{t('onlineOrders.prepare')}</Button> : null}
        {order.sales_invoice?.status === 'HELD' && canCreate ? <Button variant="secondary" onClick={() => void openHeldBill()}>{t('onlineOrders.openHeld')}</Button> : null}
        {advanceLabel && canCreate ? <Button variant="outline" loading={action.isPending} onClick={() => action.mutate('advance')}>{t(advanceLabel)}</Button> : null}
        {!['DELIVERED', 'CANCELLED'].includes(order.status) && canCancel ? <Button variant="ghost" loading={action.isPending} onClick={() => action.mutate('cancel')}>{t('onlineOrders.cancel')}</Button> : null}
      </div>
    </Card>
  );
}

export function OnlineOrdersPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OnlineOrderStatus | ''>('');
  const orders = useQuery({
    queryKey: ['storefront', 'orders', status],
    queryFn: () => listOnlineOrders(status || undefined),
  });
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={t('onlineOrders.title')} description={t('onlineOrders.description')} actions={<select aria-label={t('onlineOrders.filterAria')} value={status} onChange={(event) => setStatus(event.target.value as OnlineOrderStatus | '')} className="rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">{t('onlineOrders.allStatuses')}</option>{Object.entries(STATUS_KEYS).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select>} />
      {orders.isPending ? <p className="text-sm text-muted-foreground">{t('onlineOrders.loading')}</p> : null}
      {orders.error ? <p role="alert" className="text-sm text-destructive">{orders.error instanceof ApiError ? orders.error.message : t('onlineOrders.loadError')}</p> : null}
      {orders.data?.length === 0 ? <Card><p className="py-8 text-center text-sm text-muted-foreground">{t('onlineOrders.empty')}</p></Card> : null}
      {orders.data?.map((order) => <OrderCard key={order.id} order={order} />)}
    </main>
  );
}
