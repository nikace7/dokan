import { useEffect, useState } from 'react';

import { getMyOrders } from '../lib/api';
import type { ShopperSession, SiteInfo, StoreOrder } from '../lib/api';
import { formatPriceRange } from '../lib/money';
import { CommerceShell } from './CommerceShell';
import { useCommerce } from './CommerceProvider';
import { EmailLogin } from './EmailLogin';

function OrderHistory({ site, session }: { site: SiteInfo; session: ShopperSession }) {
  const [orders, setOrders] = useState<StoreOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMyOrders(session.token)
      .then((value) => { if (!cancelled) setOrders(value); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load orders.'); });
    return () => { cancelled = true; };
  }, [session.token]);
  if (error) return <p role="alert" className="mt-8 text-[#8c2f2f]">{error}</p>;
  if (!orders) return <p className="mt-8 animate-pulse">Loading your orders…</p>;
  if (orders.length === 0) return <div className="mt-8 rounded-2xl border border-black/10 bg-white p-8 text-center"><p>No orders yet.</p><a href="/" className="mt-4 inline-block underline">Browse the collection</a></div>;
  return <div className="mt-8 space-y-4">{orders.map((order) => <a key={order.tracking_token} href={`/order/${order.tracking_token}`} className="flex items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white p-5 transition-transform hover:-translate-y-0.5"><div><h2 className="font-serif text-xl">{order.number_text}</h2><p className="mt-1 text-sm text-black/50">{order.status.toLowerCase().replace(/^./, (letter) => letter.toUpperCase())} · {order.items.length} item{order.items.length === 1 ? '' : 's'}</p></div><strong>{formatPriceRange(order.total, null, site.currency)}</strong></a>)}</div>;
}

export function OrdersPage({ site }: { site: SiteInfo }) {
  const { session } = useCommerce();
  return <CommerceShell site={site}><main className="mx-auto max-w-3xl px-5 py-12"><p className="text-xs uppercase tracking-[0.22em] text-[#6d2b2b]">Your account</p><h1 className="mt-2 font-serif text-4xl">Orders</h1>{session ? <OrderHistory site={site} session={session} /> : <div className="mt-8"><EmailLogin /></div>}</main></CommerceShell>;
}
