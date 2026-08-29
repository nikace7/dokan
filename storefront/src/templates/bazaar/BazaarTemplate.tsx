import { useState } from 'react';

import { QuickViewModal } from '../../components/QuickViewModal';
import { ProductImage } from '../../components/ProductImage';
import { useDebouncedValue, useRevealOnScroll, useScrolledPast } from '../../components/hooks';
import { useProducts } from '../../components/useProducts';
import type { Product, SiteCategory } from '../../lib/api';
import { formatPriceRange } from '../../lib/money';
import type { TemplateProps } from '..';

/**
 * Bazaar palette — warm ivory base, deep emerald ink, brushed-brass accents.
 * Kept as constants so every section shares the same tonal decisions.
 */
const INK = 'text-[#17241f]';
const ACCENT = 'text-[#a5812e]';

const MARQUEE_ITEMS = ['New arrivals', 'Genuine brands', 'Fair prices', 'Visit us in store'];

/**
 * Bazaar — refined grand-bazaar elegance. Ivory/emerald/brass palette, serif
 * display type, arch-framed hero imagery, a slow brass marquee, and quiet
 * lift-on-hover cards. The warm, formal counterpart to Aurora's minimalism.
 */
export function BazaarTemplate({ site }: TemplateProps) {
  const scrolled = useScrolledPast(24);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const { products, meta, loading, loadingMore, error, hasMore, loadMore, retry } = useProducts(
    category,
    debouncedSearch,
  );
  const [quickView, setQuickView] = useState<Product | null>(null);

  const heroProduct = products[0] ?? null;
  const heroSecond = products[1] ?? null;

  return (
    <div className={`min-h-screen bg-[#f7f3eb] font-sans ${INK} antialiased`}>
      {/* Fixed header — gains a hairline + blur once the hero scrolls away. */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
          scrolled
            ? 'border-b border-[#17241f]/10 bg-[#f7f3eb]/85 backdrop-blur-md'
            : 'border-b border-transparent'
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <a href="#top" className="font-serif text-lg tracking-tight">
            {site.shop_name}
          </a>
          <nav className="flex items-center gap-6">
            <a
              href="#shop"
              className={`hidden text-xs uppercase tracking-[0.25em] ${ACCENT} hover:underline sm:inline`}
            >
              Collection
            </a>
            {site.contact.phone ? (
              <a
                href={`tel:${site.contact.phone}`}
                className="rounded-full bg-[#17241f] px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-[#f7f3eb] transition-colors hover:bg-[#24382f]"
              >
                Call us
              </a>
            ) : null}
          </nav>
        </div>
      </header>

      {/* Hero — editorial text beside an arch-framed product portrait. */}
      <section id="top" className="relative overflow-hidden pb-16 pt-28 sm:pt-32">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#c9a84c]/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-32 top-40 h-80 w-80 rounded-full bg-[#2f5d4a]/15 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className={`flex items-center gap-3 text-xs uppercase tracking-[0.3em] ${ACCENT}`}>
              <span className="h-px w-8 bg-[#a5812e]/60" aria-hidden="true" />
              Online store
            </p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
              {site.shop_name}
            </h1>
            {site.shop_name_np ? (
              <p className="mt-3 font-serif text-2xl text-[#17241f]/55">{site.shop_name_np}</p>
            ) : null}
            <p className="mt-6 max-w-md text-sm leading-relaxed text-[#17241f]/70 sm:text-base">
              A hand-picked rail of genuine clothing at honest prices. Browse the collection
              online — then call us or visit the store to take it home.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#shop"
                className="rounded-full bg-[#17241f] px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#f7f3eb] transition-colors hover:bg-[#24382f]"
              >
                Browse the collection
              </a>
              {site.contact.phone ? (
                <a
                  href={`tel:${site.contact.phone}`}
                  className="rounded-full border border-[#17241f]/25 px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] transition-colors hover:border-[#17241f] hover:bg-white/60"
                >
                  {site.contact.phone}
                </a>
              ) : null}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-sm pb-8 lg:max-w-none">
            <div className="relative aspect-[4/5] overflow-hidden rounded-b-[1.5rem] rounded-t-[999px] border border-[#c9a84c]/30 bg-[#ece5d8] shadow-[0_30px_60px_-30px_rgba(23,36,31,0.35)]">
              <ProductImage
                src={heroProduct?.image ?? null}
                alt={heroProduct?.name ?? site.shop_name}
                loading="eager"
                className="h-full w-full object-cover"
                fallbackClassName="flex h-full w-full items-center justify-center font-serif text-8xl text-[#17241f]/20"
              />
            </div>
            {heroSecond?.image ? (
              <div className="absolute -bottom-2 -left-4 w-32 overflow-hidden rounded-b-[1.25rem] rounded-t-[999px] border-4 border-[#f7f3eb] bg-[#ece5d8] shadow-lg sm:-left-8 sm:w-40">
                <div className="aspect-[4/5]">
                  <ProductImage
                    src={heroSecond.image}
                    alt={heroSecond.name}
                    className="h-full w-full object-cover"
                    fallbackClassName="flex h-full w-full items-center justify-center font-serif text-4xl text-[#17241f]/20"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Brass marquee — slow, quiet, aria-hidden with an sr-only equivalent. */}
      <div className="border-y border-[#c9a84c]/25 bg-[#17241f] py-3 text-[#e6d3a3]">
        <div
          className="flex w-max whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.35em] motion-safe:animate-[bazaar-marquee_36s_linear_infinite]"
          aria-hidden="true"
        >
          {[0, 1].map((copy) => (
            <span key={copy} className="flex">
              {MARQUEE_ITEMS.map((item) => (
                <span key={`${copy}-${item}`} className="mx-8 flex items-center gap-16">
                  {item}
                  <span className="text-[#c9a84c]">✦</span>
                </span>
              ))}
            </span>
          ))}
        </div>
        <span className="sr-only">{MARQUEE_ITEMS.join(' · ')}</span>
      </div>

      {/* Collection */}
      <main id="shop" className="mx-auto max-w-6xl px-5 pb-24 pt-14">
        <div className="mb-10 flex flex-col gap-6 border-b border-[#17241f]/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-serif text-3xl tracking-tight sm:text-4xl">The Collection</h2>
            <p className="mt-1 text-xs uppercase tracking-[0.25em] text-[#17241f]/50">
              {meta ? `${meta.count} pieces` : 'Browse everything'}
            </p>
          </div>
          <label className="block w-full sm:max-w-xs">
            <span className="sr-only">Search products</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the collection…"
              className="w-full rounded-full border border-[#17241f]/15 bg-[#fffdf8] px-5 py-2.5 text-sm outline-none transition-all placeholder:text-[#17241f]/40 focus:border-[#a5812e] focus:ring-4 focus:ring-[#c9a84c]/20"
            />
          </label>
        </div>

        {/* Category pills */}
        <div className="mb-12 flex flex-wrap gap-2" aria-label="Categories">
          <BazaarPill active={category === null} onClick={() => setCategory(null)} label="All" />
          {site.categories.map((cat: SiteCategory) => (
            <BazaarPill
              key={cat.id}
              active={category === cat.id}
              onClick={() => setCategory(cat.id)}
              label={cat.name}
              count={cat.product_count}
            />
          ))}
        </div>

        {error ? (
          <div className="rounded-3xl border border-[#8c2f2f]/25 bg-[#fffdf8] p-12 text-center">
            <p className="font-serif text-xl text-[#8c2f2f]">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-5 rounded-full border border-[#17241f] px-6 py-2.5 text-xs uppercase tracking-[0.2em] transition-colors hover:bg-[#17241f] hover:text-[#f7f3eb]"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <BazaarSkeleton />
        ) : products.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#17241f]/20 bg-[#fffdf8]/60 p-16 text-center">
            <p className="font-serif text-2xl text-[#17241f]/70">Nothing matches that search</p>
            <p className="mt-2 text-sm text-[#17241f]/50">
              Try another word, or browse a different category.
            </p>
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
            <div className="mt-16 flex flex-col items-center gap-3">
              {meta ? (
                <p className="text-xs uppercase tracking-[0.25em] text-[#17241f]/50">
                  {products.length} of {meta.count} products
                </p>
              ) : null}
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full border border-[#17241f] px-8 py-3 text-xs font-semibold uppercase tracking-[0.25em] transition-colors hover:bg-[#17241f] hover:text-[#f7f3eb] disabled:opacity-40"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-[#c9a84c]/20 bg-[#17241f] text-[#f7f3eb]">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-14 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-serif text-2xl tracking-tight">{site.shop_name}</p>
            <div className="mt-2 h-px w-12 bg-[#c9a84c]/60" aria-hidden="true" />
            {site.contact.address ? (
              <p className="mt-3 text-sm text-[#f7f3eb]/60">{site.contact.address}</p>
            ) : null}
            {site.contact.phone ? (
              <a
                href={`tel:${site.contact.phone}`}
                className="mt-1 inline-block text-sm font-medium text-[#e6d3a3] hover:underline"
              >
                {site.contact.phone}
              </a>
            ) : null}
          </div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[#f7f3eb]/40">
            Powered by Mero Pasal
          </p>
        </div>
      </footer>

      <QuickViewModal
        open={quickView !== null}
        onClose={() => setQuickView(null)}
        label={quickView?.name ?? 'Product details'}
        backdropClassName="fixed inset-0 z-50 flex items-end justify-center bg-[#17241f]/50 backdrop-blur-sm sm:items-center sm:p-6"
        panelClassName="w-full max-w-lg overflow-hidden rounded-t-[1.75rem] bg-[#f7f3eb] shadow-2xl outline-none motion-safe:animate-[bazaar-slide-up_0.25s_ease-out] sm:max-w-3xl sm:rounded-[1.75rem] sm:motion-safe:animate-[bazaar-pop_0.3s_ease-out]"
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

function BazaarPill({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition-all ${
        active
          ? 'bg-[#17241f] text-[#f7f3eb] shadow-md'
          : 'border border-[#17241f]/15 bg-[#fffdf8]/70 text-[#17241f]/70 hover:border-[#17241f]/40 hover:text-[#17241f]'
      }`}
    >
      {label}
      {count !== undefined ? (
        <span className={`ml-1.5 ${active ? 'text-[#c9a84c]' : 'text-[#17241f]/40'}`}>{count}</span>
      ) : null}
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
        className="group block w-full rounded-[1.4rem] bg-[#fffdf8] p-3 text-left shadow-[0_1px_3px_rgba(23,36,31,0.08)] ring-1 ring-[#17241f]/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-20px_rgba(23,36,31,0.35)]"
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-[1rem] bg-[#ece5d8]">
          <ProductImage
            src={product.image}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
            fallbackClassName="flex h-full w-full items-center justify-center font-serif text-6xl text-[#17241f]/20"
          />
          {muted ? (
            <span className="absolute left-3 top-3 rounded-full bg-[#17241f]/85 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f7f3eb]">
              Sold out
            </span>
          ) : null}
          <span className="absolute inset-x-0 bottom-0 translate-y-full bg-[#17241f]/90 py-2.5 text-center text-[11px] font-medium uppercase tracking-[0.25em] text-[#f7f3eb] transition-transform duration-300 group-hover:translate-y-0">
            Quick view
          </span>
        </div>
        <div className="px-1.5 pb-1 pt-4">
          <h3 className="font-serif text-lg leading-snug tracking-tight">{product.name}</h3>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <p className="truncate text-[11px] uppercase tracking-[0.18em] text-[#17241f]/45">
              {product.brand ?? ' '}
            </p>
            <p className="shrink-0 font-serif text-[15px]">
              {formatPriceRange(product.price_min, product.price_max, currency)}
            </p>
          </div>
        </div>
      </button>
    </article>
  );
}

function BazaarSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-[1.4rem] bg-[#fffdf8] p-3 ring-1 ring-[#17241f]/5"
        >
          <div className="aspect-[4/5] rounded-[1rem] bg-[#ece5d8]" />
          <div className="mx-1.5 mt-4 h-4 w-2/3 rounded bg-[#ece5d8]" />
          <div className="mx-1.5 mb-1 mt-2 h-3 w-1/3 rounded bg-[#ece5d8]" />
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
    <div className="grid sm:grid-cols-2">
      <div className="relative aspect-[4/3] bg-[#ece5d8] sm:aspect-[4/5]">
        <ProductImage
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center font-serif text-8xl text-[#17241f]/20"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#f7f3eb]/90 text-xl leading-none text-[#17241f] shadow-md transition-transform hover:scale-105"
        >
          ×
        </button>
        {!product.in_stock ? (
          <span className="absolute left-3 top-3 rounded-full bg-[#17241f]/85 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f7f3eb]">
            Sold out
          </span>
        ) : null}
      </div>
      <div className="flex flex-col p-6 sm:p-8">
        <p className={`text-[11px] uppercase tracking-[0.25em] ${ACCENT}`}>
          {product.brand ?? 'Unbranded'}
        </p>
        <h3 className="mt-1 font-serif text-2xl tracking-tight sm:text-3xl">{product.name}</h3>
        {product.name_np ? <p className="mt-1 text-[#17241f]/60">{product.name_np}</p> : null}
        <div className="my-5 h-px w-12 bg-[#c9a84c]/60" aria-hidden="true" />
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between border-b border-[#17241f]/10 pb-2">
            <dt className="text-[#17241f]/50">Code</dt>
            <dd>{product.code}</dd>
          </div>
          <div className="flex justify-between border-b border-[#17241f]/10 pb-2">
            <dt className="text-[#17241f]/50">Category</dt>
            <dd>{product.category ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#17241f]/50">Availability</dt>
            <dd className={product.in_stock ? 'text-[#2f5d4a]' : 'text-[#8c2f2f]'}>
              {product.in_stock ? 'In stock' : 'Out of stock'}
            </dd>
          </div>
        </dl>
        <p className="mt-6 font-serif text-2xl tracking-tight sm:text-3xl">
          {formatPriceRange(product.price_min, product.price_max, currency)}
        </p>
        <div className="mt-auto pt-7">
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="block rounded-full bg-[#17241f] py-3.5 text-center text-xs font-semibold uppercase tracking-[0.25em] text-[#f7f3eb] transition-colors hover:bg-[#24382f]"
            >
              Call to order · {phone}
            </a>
          ) : (
            <p className="text-center text-xs uppercase tracking-[0.25em] text-[#17241f]/50">
              Visit our store to order
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
