import { useEffect, useState } from 'react';

import { ProductImage } from '../components/ProductImage';
import { getProduct } from '../lib/api';
import type { ProductDetail, ProductVariant, SiteInfo } from '../lib/api';
import { formatPriceRange } from '../lib/money';
import { CommerceShell } from './CommerceShell';
import { useCommerce } from './CommerceProvider';

export function ProductPage({ site, productId }: { site: SiteInfo; productId: string }) {
  const { addItem, itemCount } = useCommerce();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [selected, setSelected] = useState<ProductVariant | null>(null);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProduct(productId)
      .then((value) => {
        if (!cancelled) {
          setProduct(value);
          document.title = `${value.name} · ${site.shop_name}`;
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Product unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, [productId, site.shop_name]);

  if (error) {
    return <CommerceShell site={site}><main className="mx-auto max-w-3xl px-5 py-20 text-center"><h1 className="font-serif text-3xl">Product unavailable</h1><p className="mt-3 text-[#1a1a18]/60">{error}</p><a href="/" className="mt-6 inline-block underline">Back to the collection</a></main></CommerceShell>;
  }
  if (!product) {
    return <CommerceShell site={site}><main className="mx-auto max-w-5xl animate-pulse px-5 py-16"><div className="aspect-4/3 rounded-2xl bg-black/10" /></main></CommerceShell>;
  }

  const price = selected?.price ?? product.website_price;
  const compareAt = selected?.compare_at ?? product.website_compare_at;
  const canAdd = Boolean(selected?.in_stock && price);

  return (
    <CommerceShell site={site}>
      <main className="mx-auto grid max-w-5xl gap-10 px-5 py-10 md:grid-cols-2 md:py-16">
        <div className="aspect-4/5 overflow-hidden rounded-2xl bg-[#efece4]">
          <ProductImage src={product.image} alt={product.name} className="h-full w-full object-cover" fallbackClassName="flex h-full items-center justify-center font-serif text-8xl text-black/15" />
        </div>
        <div className="md:pt-8">
          <p className="text-xs uppercase tracking-[0.22em] text-[#6d2b2b]">{product.brand || product.category || 'Collection'}</p>
          <h1 className="mt-3 font-serif text-4xl tracking-tight sm:text-5xl">{product.name}</h1>
          {product.name_np ? <p className="mt-2 text-xl text-[#1a1a18]/55">{product.name_np}</p> : null}
          <p className="mt-6 font-serif text-2xl">
            {compareAt ? <span className="mr-3 text-lg text-black/35 line-through">{formatPriceRange(compareAt, null, site.currency)}</span> : null}
            {price ? formatPriceRange(price, null, site.currency) : 'Select an option for price'}
          </p>
          <fieldset className="mt-8">
            <legend className="text-sm font-semibold">Choose size and colour</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {product.variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  disabled={!variant.in_stock || !variant.price}
                  onClick={() => setSelected(variant)}
                  aria-pressed={selected?.id === variant.id}
                  className="rounded-full border border-[#1a1a18]/25 px-4 py-2 text-sm aria-pressed:border-[#1a1a18] aria-pressed:bg-[#1a1a18] aria-pressed:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {variant.size} / {variant.color}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="mt-6 block max-w-28 text-sm font-semibold">
            Quantity
            <input type="number" min="1" max="99" value={qty} onChange={(event) => setQty(Math.max(1, Number(event.target.value) || 1))} className="mt-2 w-full rounded-lg border border-black/20 px-3 py-2" />
          </label>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => {
              if (!selected || !price) return;
              addItem({ variantId: selected.id, productId: product.id, name: product.name, image: product.image, size: selected.size, color: selected.color, unitPrice: price, compareAt, qty });
            }}
            className="mt-8 w-full rounded-full bg-[#1a1a18] px-6 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white disabled:opacity-35"
          >
            Add to bag
          </button>
          {itemCount ? <a href="/cart" className="mt-4 block text-center text-sm font-semibold underline">View bag ({itemCount})</a> : null}
          {!product.variants.some((variant) => variant.in_stock) ? <p className="mt-4 text-center text-sm text-[#8c2f2f]">Currently sold out</p> : null}
          <p className="mt-8 border-t border-black/10 pt-5 text-sm leading-relaxed text-black/55">Secure email-code checkout · Cash on delivery or store pickup · Final availability is confirmed at checkout.</p>
        </div>
      </main>
    </CommerceShell>
  );
}
