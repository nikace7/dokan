import type { SiteInfo, StoreOrder } from '../lib/api';
import { formatPriceRange } from '../lib/money';

const STATUS_LABELS: Record<StoreOrder['status'], string> = {
  PLACED: 'Placed',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const PROGRESS: StoreOrder['status'][] = ['PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED'];

export function OrderSummary({ order, site }: { order: StoreOrder; site: SiteInfo }) {
  const current = PROGRESS.indexOf(order.status);
  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-2xl border border-black/10 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] text-black/45">Current status</p><p className="mt-1 font-serif text-2xl">{STATUS_LABELS[order.status]}</p></div><span className="rounded-full bg-[#efece4] px-4 py-2 text-sm">{order.fulfillment === 'PICKUP' ? 'Store pickup' : 'Delivery'} · COD</span></div>
        {order.status !== 'CANCELLED' ? <ol className="mt-6 grid grid-cols-5 gap-1" aria-label="Order progress">{PROGRESS.map((status, index) => <li key={status} className={`border-t-4 pt-2 text-[10px] sm:text-xs ${index <= current ? 'border-[#1a1a18] text-[#1a1a18]' : 'border-black/10 text-black/35'}`}>{STATUS_LABELS[status]}</li>)}</ol> : <p className="mt-5 text-sm text-[#8c2f2f]">This order was cancelled. Its stock reservation has been released.</p>}
      </section>
      <section className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="font-serif text-2xl">Items</h2><ul className="mt-4 divide-y divide-black/10">{order.items.map((item, index) => <li key={`${item.name}-${item.size}-${item.color}-${index}`} className="flex justify-between gap-4 py-4 text-sm"><span>{item.name} · {item.size}/{item.color} × {Number(item.qty)}</span><strong>{formatPriceRange(item.line_total, null, order.currency)}</strong></li>)}</ul><div className="flex justify-between border-t border-black/15 pt-4 text-lg"><span>Total</span><strong>{formatPriceRange(order.total, null, order.currency)}</strong></div></section>
      <section className="rounded-2xl border border-black/10 bg-white p-5 text-sm"><h2 className="font-serif text-xl">Fulfillment details</h2>{order.address ? <p className="mt-3">{[order.address.line1, order.address.area, order.address.city, order.address.landmark].filter(Boolean).join(', ')}</p> : <p className="mt-3">Pickup from {site.contact.address || 'the shop'}.</p>}{order.note ? <p className="mt-2 text-black/55">Note: {order.note}</p> : null}{site.contact.phone ? <p className="mt-3">Need help? <a className="underline" href={`tel:${site.contact.phone}`}>{site.contact.phone}</a></p> : null}</section>
    </div>
  );
}
