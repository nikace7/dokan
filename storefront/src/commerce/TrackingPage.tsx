import { useEffect, useState } from 'react';

import { getOrder } from '../lib/api';
import type { SiteInfo, StoreOrder } from '../lib/api';
import { CommerceShell } from './CommerceShell';
import { OrderSummary } from './OrderSummary';

export function TrackingPage({ site, trackingToken }: { site: SiteInfo; trackingToken: string }) {
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getOrder(trackingToken)
      .then((value) => { if (!cancelled) { setOrder(value); document.title = `${value.number_text} · ${site.shop_name}`; } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load this order.'); });
    return () => { cancelled = true; };
  }, [trackingToken, site.shop_name]);
  return <CommerceShell site={site}><main className="mx-auto max-w-3xl px-5 py-12">{error ? <div className="text-center"><h1 className="font-serif text-4xl">Order not found</h1><p className="mt-3 text-black/55">{error}</p></div> : order ? <><p className="text-xs uppercase tracking-[0.22em] text-[#6d2b2b]">Order tracking</p><h1 className="mt-2 font-serif text-4xl">{order.number_text}</h1><p className="mt-2 text-sm text-black/50">Placed on {order.business_date_ad} · BS {order.business_date_bs}</p><OrderSummary order={order} site={site} /></> : <p aria-label="Loading order" className="animate-pulse text-center">Loading your order…</p>}</main></CommerceShell>;
}
