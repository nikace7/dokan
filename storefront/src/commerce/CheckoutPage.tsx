import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { placeOrder } from '../lib/api';
import type { CheckoutPayload, ShopperSession, SiteInfo } from '../lib/api';
import { formatPriceRange } from '../lib/money';
import { CommerceShell } from './CommerceShell';
import { useCommerce } from './CommerceProvider';
import { EmailLogin } from './EmailLogin';

function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function CheckoutForm({ site, session, navigate }: { site: SiteInfo; session: ShopperSession; navigate: (path: string) => void }) {
  const { items, clearCart } = useCommerce();
  const [fullName, setFullName] = useState(session.customer.full_name);
  const [phone, setPhone] = useState(session.customer.phone);
  const [fulfillment, setFulfillment] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [landmark, setLandmark] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());
  const estimated = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.qty, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const payload: CheckoutPayload = {
      customer: { email: session.customer.email, full_name: fullName.trim(), phone: phone.trim() },
      fulfillment,
      payment_method: 'COD',
      address: fulfillment === 'DELIVERY' ? { line1: line1.trim(), city: city.trim(), area: area.trim(), landmark: landmark.trim(), note: '' } : null,
      note: note.trim(),
      items: items.map((item) => ({ variant: item.variantId, qty: String(item.qty) })),
    };
    try {
      const order = await placeOrder(payload, session.token, idempotencyKey.current);
      clearCart();
      navigate(`/order/${order.tracking_token}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not place your order.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-4xl gap-8 px-5 py-10 lg:grid-cols-[1fr_320px]">
      <div className="space-y-7"><div><p className="text-xs uppercase tracking-[0.22em] text-[#6d2b2b]">Final step</p><h1 className="mt-2 font-serif text-4xl">Checkout</h1><p className="mt-2 text-sm text-black/55">Signed in as {session.customer.email}</p></div>
        <section className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="font-serif text-2xl">Contact</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Full name<input required autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 w-full rounded-lg border border-black/20 px-3 py-3" /></label><label className="text-sm font-medium">Phone number<input required autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-2 w-full rounded-lg border border-black/20 px-3 py-3" /></label></div></section>
        <section className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="font-serif text-2xl">Fulfillment</h2><div className="mt-4 grid grid-cols-2 gap-3"><label className="rounded-xl border border-black/15 p-4"><input type="radio" name="fulfillment" checked={fulfillment === 'PICKUP'} onChange={() => setFulfillment('PICKUP')} /> <span className="ml-2 font-semibold">Store pickup</span></label><label className="rounded-xl border border-black/15 p-4"><input type="radio" name="fulfillment" checked={fulfillment === 'DELIVERY'} onChange={() => setFulfillment('DELIVERY')} /> <span className="ml-2 font-semibold">Delivery</span></label></div>{fulfillment === 'DELIVERY' ? <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm">Street address<input required value={line1} onChange={(event) => setLine1(event.target.value)} className="mt-1 w-full rounded-lg border border-black/20 px-3 py-3" /></label><label className="text-sm">City<input required value={city} onChange={(event) => setCity(event.target.value)} className="mt-1 w-full rounded-lg border border-black/20 px-3 py-3" /></label><label className="text-sm">Area<input value={area} onChange={(event) => setArea(event.target.value)} className="mt-1 w-full rounded-lg border border-black/20 px-3 py-3" /></label><label className="text-sm">Landmark<input value={landmark} onChange={(event) => setLandmark(event.target.value)} className="mt-1 w-full rounded-lg border border-black/20 px-3 py-3" /></label></div> : <p className="mt-4 text-sm text-black/55">Pickup from {site.contact.address || 'the shop'}. The shop will confirm when it is ready.</p>}</section>
        <label className="block text-sm font-medium">Order note (optional)<textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-2 min-h-24 w-full rounded-lg border border-black/20 px-3 py-3" /></label>
      </div>
      <aside className="h-fit rounded-2xl bg-[#1a1a18] p-6 text-white lg:sticky lg:top-24"><h2 className="font-serif text-2xl">Order summary</h2><ul className="mt-5 space-y-3 text-sm">{items.map((item) => <li key={item.variantId} className="flex justify-between gap-3"><span>{item.name} · {item.size}/{item.color} × {item.qty}</span><span>{formatPriceRange(String(Number(item.unitPrice) * item.qty), null, site.currency)}</span></li>)}</ul><div className="mt-5 flex justify-between border-t border-white/20 pt-5"><span>Estimated total</span><strong>{formatPriceRange(String(estimated), null, site.currency)}</strong></div><p className="mt-4 text-xs leading-relaxed text-white/60">Cash on delivery/pickup. Online payment stays disabled until a verified gateway is connected.</p><button type="submit" disabled={busy || items.length === 0} className="mt-6 w-full rounded-full bg-white px-5 py-3 text-sm font-bold text-[#1a1a18] disabled:opacity-50">{busy ? 'Placing order…' : 'Place COD order'}</button>{error ? <p role="alert" className="mt-4 text-sm text-[#ffb4ab]">{error}</p> : null}</aside>
    </form>
  );
}

export function CheckoutPage({ site, navigate }: { site: SiteInfo; navigate: (path: string) => void }) {
  const { items, session } = useCommerce();
  if (items.length === 0) return <CommerceShell site={site}><main className="mx-auto max-w-xl px-5 py-20 text-center"><h1 className="font-serif text-4xl">Your bag is empty</h1><a href="/" className="mt-5 inline-block underline">Browse products</a></main></CommerceShell>;
  return <CommerceShell site={site}>{session ? <CheckoutForm site={site} session={session} navigate={navigate} /> : <main className="px-5 py-14"><EmailLogin /></main>}</CommerceShell>;
}
