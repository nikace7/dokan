import { useState } from 'react';

import { QuickViewModal } from '../../components/QuickViewModal';
import { ProductImage } from '../../components/ProductImage';
import { useDebouncedValue, useRevealOnScroll } from '../../components/hooks';
import { useProducts } from '../../components/useProducts';
import type { Product, SiteCategory } from '../../lib/api';
import { formatPriceRange } from '../../lib/money';
import type { TemplateProps } from '..';

const MARQUEE_ITEMS = ['NEW ARRIVALS', 'GENUINE BRANDS', 'VISIT OUR STORE', 'BEST PRICES IN TOWN'];

const CHIP_COLORS = [
  'bg-indigo-600',
  'bg-fuchsia-600',
  'bg-amber-500',
  'bg-emerald-600',
  'bg-rose-500',
  'bg-sky-600',
];

/**
 * Bazaar — vibrant marketplace. Big gradient hero, marquee strip, playful
 * tilt-lift cards, punchy price chips, springy modal.
 */
export function BazaarTemplate({ site }: TemplateProps) {
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const { products, meta, loading, loadingMore, error, hasMore, loadMore, retry } = useProducts(
    category,
    debouncedSearch,
  );
  const [quickView, setQuickView] = useState<Product | null>(null);

  return (
    <div className="min-h-screen bg-[#fff7ed] font-sans text-slate-900 antialiased [background-image:radial-gradient(#f5d0fe_1px,transparent_1px)] [background-size:22px_22px]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b-4 border-slate-900 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="#top" className="text-xl font-black tracking-tight">
            {site.shop_name}
          </a>
          <a
            href="#shop"
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-transform motion-safe:hover:animate-[bazaar-wiggle_0.4s_ease-in-out]"
          >
            Shop now ↓
          </a>
        </div>
      </header>

      {/* Gradient hero + marquee */}
      <section id="top" className="relative overflow-hidden bg-[linear-gradient(120deg,#4f46e5_0%,#c026d3_55%,#f59e0b_100%)] text-white">
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:pb-24 sm:pt-20">
          <p className="mb-4 inline-block rounded-full bg-white/20 px-4 py-1 text-xs font-bold uppercase tracking-[0.2em]">
            Online store
          </p>
          <h1 className="max-w-3xl text-5xl font-black leading-[1.02] tracking-tight sm:text-7xl">
            {site.shop_name}
          </h1>
          {site.shop_name_np ? (
            <p className="mt-3 text-2xl font-bold text-white/85">{site.shop_name_np}</p>
          ) : null}
          <p className="mt-5 max-w-xl text-base font-medium text-white/90 sm:text-lg">
            Everything you love from our racks — scroll, tap, and grab it before it&apos;s gone.
            Call us and we&apos;ll keep it aside!
          </p>
        </div>
        <div className="border-t-4 border-slate-900 bg-amber-400 py-2 text-slate-900">
          <div
            className="flex w-max whitespace-nowrap font-black uppercase tracking-wider motion-safe:animate-[bazaar-marquee_18s_linear_infinite]"
            aria-hidden="true"
          >
            {[0, 1].map((copy) => (
              <span key={copy} className="flex">
                {MARQUEE_ITEMS.map((item) => (
                  <span key={`${copy}-${item}`} className="mx-6">
                    {item} ✦
                  </span>
                ))}
              </span>
            ))}
          </div>
          <span className="sr-only">{MARQUEE_ITEMS.join(' · ')}</span>
        </div>
      </section>

      {/* Shop section */}
      <main id="shop" className="mx-auto max-w-6xl px-4 pb-24 pt-10">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
            Fresh on the rack 🛍️
          </h2>
          <label className="block w-full sm:max-w-xs">
            <span className="sr-only">Search products</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search shirts, jeans…"
              className="w-full rounded-full border-2 border-slate-900 bg-white px-4 py-2 text-sm font-semibold outline-none transition-shadow placeholder:text-slate-400 focus:ring-4 focus:ring-fuchsia-400/60"
            />
          </label>
        </div>

        {/* Category pills */}
        <div className="mb-10 flex flex-wrap gap-2" aria-label="Categories">
          <BazaarChip
            color="bg-slate-900"
            active={category === null}
            onClick={() => setCategory(null)}
            label="✨ All"
          />
          {site.categories.map((cat: SiteCategory, i: number) => (
            <BazaarChip
              key={cat.id}
              color={CHIP_COLORS[i % CHIP_COLORS.length]}
              active={category === cat.id}
              onClick={() => setCategory(cat.id)}
              label={`${cat.name} (${cat.product_count})`}
            />
          ))}
        </div>

        {error ? (
          <div className="rounded-3xl border-4 border-rose-300 bg-white p-10 text-center">
            <p className="font-bold text-rose-600">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-4 rounded-full bg-rose-500 px-6 py-2 font-bold text-white transition-transform motion-safe:hover:animate-[bazaar-wiggle_0.4s_ease-in-out]"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <BazaarSkeleton />
        ) : products.length === 0 ? (
          <div className="rounded-3xl border-4 border-dashed border-slate-300 bg-white/70 p-12 text-center">
            <p className="text-2xl font-black">Hmm… nothing found 😅</p>
            <p className="mt-2 font-semibold text-slate-500">Try a different search or category.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3">
              {products.map((product, index) => (
                <BazaarCard
                  key={product.id}
                  product={product}
                  currency={site.currency}
                  index={index}
                  onQuickView={() => setQuickView(product)}
                />
              ))}
            </div>
            <div className="mt-12 flex flex-col items-center gap-3">
              {meta ? (
                <p className="rounded-full bg-white px-4 py-1 text-sm font-bold text-slate-600 shadow-sm">
                  {products.length} of {meta.count} products
                </p>
              ) : null}
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-8 py-3 font-black text-white shadow-lg transition-transform motion-safe:hover:animate-[bazaar-wiggle_0.4s_ease-in-out] disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Show me more!'}
                </button>
              ) : null}
            </div>
          </>
        )}
      </main>

      <footer className="bg-indigo-950 text-indigo-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-2xl font-black">{site.shop_name} 🎉</p>
            {site.contact.address ? (
              <p className="mt-2 text-sm font-semibold text-indigo-300">{site.contact.address}</p>
            ) : null}
            {site.contact.phone ? (
              <a
                href={`tel:${site.contact.phone}`}
                className="mt-1 inline-block rounded-full bg-indigo-900 px-3 py-1 text-sm font-bold text-amber-300 hover:underline"
              >
                📞 {site.contact.phone}
              </a>
            ) : null}
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">
            Powered by Mero Pasal
          </p>
        </div>
      </footer>

      <QuickViewModal
        open={quickView !== null}
        onClose={() => setQuickView(null)}
        label={quickView?.name ?? 'Product details'}
        backdropClassName="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-6"
        panelClassName="w-full max-w-lg overflow-hidden rounded-t-3xl bg-white shadow-2xl outline-none motion-safe:animate-[bazaar-slide-up_0.25s_ease-out] sm:max-w-2xl sm:rounded-3xl sm:motion-safe:animate-[bazaar-pop_0.3s_ease-out]"
      >
        {quickView ? (
          <BazaarQuickView
            product={quickView}
            currency={site.currency}
            phone={site.contact.phone}
            onClose={() => setQuickView(null)}
          />
        ) : null}
      </QuickViewModal>
    </div>
  );
}

function BazaarChip({
  color,
  active,
  onClick,
  label,
}: {
  color: string;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-2 text-sm font-bold transition-all ${
        active
          ? `${color} scale-105 text-white shadow-md ring-2 ring-slate-900 ring-offset-2`
          : 'bg-white text-slate-700 shadow-sm hover:-translate-y-0.5 hover:shadow-md'
      }`}
    >
      {label}
    </button>
  );
}

function BazaarCard({
  product,
  currency,
  index,
  onQuickView,
}: {
  product: Product;
  currency: 'NPR' | 'INR';
  index: number;
  onQuickView: () => void;
}) {
  const { ref, visible } = useRevealOnScroll<HTMLElement>();
  const muted = !product.in_stock;
  return (
    <article
      ref={ref}
      data-reveal={visible ? 'visible' : undefined}
      style={{ ['--reveal-delay' as string]: `${(index % 6) * 60}ms` }}
      className={muted ? 'opacity-70' : ''}
    >
      <button
        type="button"
        onClick={onQuickView}
        aria-label={`Quick view ${product.name}`}
        className="group relative block w-full rounded-2xl bg-white p-2 pb-4 text-left shadow-md transition-all duration-300 hover:-translate-y-1.5 hover:rotate-[-0.5deg] hover:shadow-[0_18px_35px_-12px_rgba(192,38,211,0.45)]"
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-gradient-to-br from-indigo-100 to-fuchsia-100">
          <ProductImage
            src={product.image}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            fallbackClassName="flex h-full w-full items-center justify-center text-6xl font-black text-fuchsia-300"
          />
          {muted ? (
            <span className="absolute -right-9 top-4 rotate-45 bg-rose-500 px-10 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow">
              Sold out
            </span>
          ) : null}
        </div>
        <div className="px-2 pt-3">
          <h3 className="truncate text-base font-black sm:text-lg">{product.name}</h3>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-400">
              {product.brand ?? ' '}
            </p>
            <span className="shrink-0 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-black text-slate-900 shadow-sm">
              {formatPriceRange(product.price_min, product.price_max, currency)}
            </span>
          </div>
        </div>
        <span className="pointer-events-none absolute inset-x-2 bottom-14 rounded-xl bg-slate-900/85 py-1.5 text-center text-xs font-bold text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          Quick view 👀
        </span>
      </button>
    </article>
  );
}

function BazaarSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="animate-pulse rounded-2xl bg-white p-2 pb-4 shadow-md">
          <div className="aspect-[4/5] rounded-xl bg-slate-200" />
          <div className="mx-2 mt-3 h-4 w-2/3 rounded bg-slate-200" />
          <div className="mx-2 mt-2 h-3 w-1/3 rounded bg-slate-200" />
        </div>
      ))}
    </div>
  );
}

function BazaarQuickView({
  product,
  currency,
  phone,
  onClose,
}: {
  product: Product;
  currency: 'NPR' | 'INR';
  phone: string | null;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="relative aspect-[4/3] bg-gradient-to-br from-indigo-100 to-fuchsia-100">
        <ProductImage
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center text-8xl font-black text-fuchsia-300"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-lg font-black text-white shadow-lg transition-transform hover:scale-110"
        >
          ×
        </button>
        {!product.in_stock ? (
          <span className="absolute left-3 top-3 rounded-full bg-rose-500 px-3 py-1 text-xs font-black uppercase text-white">
            Sold out
          </span>
        ) : null}
      </div>
      <div className="p-6">
        <h3 className="text-2xl font-black tracking-tight">{product.name}</h3>
        {product.name_np ? <p className="mt-1 font-semibold text-slate-500">{product.name_np}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-700">
            {product.brand ?? 'Unbranded'}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            Code {product.code}
          </span>
          <span
            className={`rounded-full px-3 py-1 ${
              product.in_stock ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
            }`}
          >
            {product.in_stock ? 'In stock ✓' : 'Out of stock'}
          </span>
        </div>
        <p className="mt-5 text-3xl font-black text-slate-900">
          {formatPriceRange(product.price_min, product.price_max, currency)}
        </p>
        {phone ? (
          <a
            href={`tel:${phone}`}
            className="mt-6 block rounded-full bg-gradient-to-r from-indigo-600 to-fuchsia-600 py-3.5 text-center font-black text-white shadow-lg transition-transform motion-safe:hover:animate-[bazaar-wiggle_0.4s_ease-in-out]"
          >
            📞 Call to order · {phone}
          </a>
        ) : (
          <p className="mt-6 rounded-2xl bg-amber-100 py-3 text-center font-bold text-amber-800">
            Visit our store to order!
          </p>
        )}
      </div>
    </div>
  );
}
