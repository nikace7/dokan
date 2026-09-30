import type { SiteInfo } from '../lib/api';
import { formatPriceRange } from '../lib/money';
import { CommerceShell } from './CommerceShell';
import { useCommerce } from './CommerceProvider';

export function CartPage({ site }: { site: SiteInfo }) {
  const { items, setQuantity, removeItem } = useCommerce();
  const total = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.qty, 0);
  return (
    <CommerceShell site={site}>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <p className="text-xs uppercase tracking-[0.22em] text-[#6d2b2b]">Your selection</p>
        <h1 className="mt-2 font-serif text-4xl">Shopping bag</h1>
        {items.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-black/10 bg-white p-8 text-center"><p>Your bag is empty.</p><a href="/" className="mt-4 inline-block underline">Browse the collection</a></div>
        ) : (
          <>
            <div className="mt-8 divide-y divide-black/10 rounded-2xl border border-black/10 bg-white px-5">
              {items.map((item) => (
                <article key={item.variantId} className="grid grid-cols-[1fr_auto] gap-4 py-5">
                  <div><a href={`/product/${item.productId}`} className="font-serif text-xl">{item.name}</a><p className="mt-1 text-sm text-black/55">{item.size} / {item.color}</p><p className="mt-2 text-sm font-semibold">{formatPriceRange(item.unitPrice, null, site.currency)}</p></div>
                  <div className="text-right"><label className="text-xs text-black/55">Quantity<input aria-label={`Quantity for ${item.name}`} type="number" min="1" max="99" value={item.qty} onChange={(event) => setQuantity(item.variantId, Number(event.target.value))} className="ml-2 w-16 rounded-sm border border-black/20 px-2 py-1" /></label><button type="button" onClick={() => removeItem(item.variantId)} className="mt-3 block w-full text-xs underline">Remove</button></div>
                </article>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between text-lg"><span>Estimated total</span><strong>{formatPriceRange(String(total), null, site.currency)}</strong></div>
            <p className="mt-2 text-sm text-black/50">The shop confirms current stock and the final server-calculated total.</p>
            <a href="/checkout" className="mt-6 block rounded-full bg-[#1a1a18] px-6 py-4 text-center text-sm font-semibold uppercase tracking-[0.18em] text-white">Continue to checkout</a>
          </>
        )}
      </main>
    </CommerceShell>
  );
}
