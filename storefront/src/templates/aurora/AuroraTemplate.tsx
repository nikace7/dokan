import { useState } from 'react';

import { QuickViewModal } from '../../components/QuickViewModal';
import { ProductImage } from '../../components/ProductImage';
import { useDebouncedValue, useRevealOnScroll, useScrolledPast } from '../../components/hooks';
import { useProducts } from '../../components/useProducts';
import type { Product, SiteCategory } from '../../lib/api';
import { formatPriceRange } from '../../lib/money';
import type { TemplateProps } from '..';

const INK = 'text-[#1a1a18]';
const ACCENT = 'text-[#6d2b2b]';

/**
 * Aurora — premium minimal boutique. Ivory/charcoal, serif display type,
 * hairline rules, editorial grid with quiet hover reveals.
 */
export function AuroraTemplate({ site }: TemplateProps) {
  const scrolled = useScrolledPast(40);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const { products, meta, loading, loadingMore, error, hasMore, loadMore, retry } = useProducts(
    category,
    debouncedSearch,
  );
  const [quickView, setQuickView] = useState<Product | null>(null);

  return (
    <div className={`min-h-screen bg-[#faf9f6] font-sans ${INK} antialiased`}>
      {/* Slim sticky header — gains a hairline + blur after scrolling. */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
          scrolled
            ? 'border-b border-[#1a1a18]/10 bg-[#faf9f6]/85 backdrop-blur-md'
            : 'border-b border-transparent'
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <a href="#top" className="font-serif text-lg tracking-tight">
            {site.shop_name}
          </a>
          <a
            href="#collection"
            className={`text-xs uppercase tracking-[0.2em] ${ACCENT} hover:underline`}
          >
            Collection
          </a>
        </div>
      </header>

      {/* Full-viewport hero */}
      <section id="top" className="relative flex min-h-[92vh] items-center overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,#efe9dd_0%,#faf9f6_55%)] motion-safe:animate-[aurora-drift_24s_ease-in-out_infinite]"
        />
        <div className="relative mx-auto w-full max-w-6xl px-5 pt-20">
          <p className={`mb-6 text-xs uppercase tracking-[0.35em] ${ACCENT}`}>
            Est. in Nepal · Curated clothing
          </p>
          <h1 className="font-serif text-[13vw] leading-[0.95] tracking-tight sm:text-7xl lg:text-8xl">
            {site.shop_name}
          </h1>
          {site.shop_name_np ? (
            <p className="mt-4 font-serif text-2xl text-[#1a1a18]/60">{site.shop_name_np}</p>
          ) : null}
          <hr className="my-8 w-24 border-t border-[#1a1a18]/30" />
          <p className="max-w-md text-sm leading-relaxed text-[#1a1a18]/70">
            A quiet edit of everyday clothing — genuine brands, honest prices. Browse the
            collection, then visit us in store.
          </p>
        </div>
        <a
          href="#collection"
          aria-label="Scroll to the collection"
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[#1a1a18]/60 motion-safe:animate-[aurora-cue_2.2s_ease-in-out_infinite]"
        >
          <svg width="20" height="28" viewBox="0 0 20 28" fill="none" aria-hidden="true">
            <path
              d="M10 2v22m0 0l-6-6m6 6l6-6"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </section>

      {/* Collection */}
      <main id="collection" className="mx-auto max-w-6xl px-5 pb-24 pt-16">
        <div className="mb-10 flex flex-col gap-6 border-b border-[#1a1a18]/15 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-serif text-3xl tracking-tight">The Collection</h2>
            <p className="mt-1 text-xs uppercase tracking-[0.25em] text-[#1a1a18]/50">
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
              className="w-full border-b border-[#1a1a18]/25 bg-transparent py-2 text-sm outline-none transition-colors placeholder:text-[#1a1a18]/40 focus:border-[#6d2b2b]"
            />
          </label>
        </div>

        {/* Category chips */}
        <div className="mb-12 flex flex-wrap gap-x-6 gap-y-2" role="list" aria-label="Categories">
          <AuroraChip active={category === null} onClick={() => setCategory(null)} label="All" />
          {site.categories.map((cat: SiteCategory) => (
            <AuroraChip
              key={cat.id}
              active={category === cat.id}
              onClick={() => setCategory(cat.id)}
              label={cat.name}
              count={cat.product_count}
            />
          ))}
        </div>

        {error ? (
          <div className="py-16 text-center">
            <p className="text-sm text-[#6d2b2b]">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-4 border border-[#1a1a18] px-5 py-2 text-xs uppercase tracking-[0.2em] transition-colors hover:bg-[#1a1a18] hover:text-[#faf9f6]"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <AuroraSkeleton />
        ) : products.length === 0 ? (
          <p className="py-16 text-center font-serif text-xl text-[#1a1a18]/50">
            Nothing matches that search — try another word.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-3 md:gap-x-8">
              {products.map((product, index) => (
                <AuroraCard
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
                <p className="text-xs uppercase tracking-[0.25em] text-[#1a1a18]/50">
                  {products.length} of {meta.count} products
                </p>
              ) : null}
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="border border-[#1a1a18] px-8 py-3 text-xs uppercase tracking-[0.25em] transition-colors hover:bg-[#1a1a18] hover:text-[#faf9f6] disabled:opacity-40"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </div>
          </>
        )}
      </main>

      <footer className="bg-[#1a1a18] text-[#faf9f6]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-14 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-serif text-2xl tracking-tight">{site.shop_name}</p>
            {site.contact.address ? (
              <p className="mt-2 text-sm text-[#faf9f6]/60">{site.contact.address}</p>
            ) : null}
            {site.contact.phone ? (
              <a
                href={`tel:${site.contact.phone}`}
                className="mt-1 block text-sm text-[#faf9f6]/80 hover:underline"
              >
                {site.contact.phone}
              </a>
            ) : null}
          </div>
          <p className="text-xs uppercase tracking-[0.25em] text-[#faf9f6]/40">
            Powered by Mero Pasal
          </p>
        </div>
      </footer>

      <QuickViewModal
        open={quickView !== null}
        onClose={() => setQuickView(null)}
        label={quickView?.name ?? 'Product details'}
        backdropClassName="fixed inset-0 z-50 flex items-center justify-center bg-[#1a1a18]/40 p-4 backdrop-blur-sm"
        panelClassName="w-full max-w-2xl border border-[#1a1a18]/15 bg-[#faf9f6] shadow-2xl outline-none"
      >
        {quickView ? (
          <AuroraQuickView
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

function AuroraChip({
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
      className={`border-b pb-1 text-sm tracking-wide transition-colors ${
        active
          ? 'border-[#6d2b2b] text-[#6d2b2b]'
          : 'border-transparent text-[#1a1a18]/60 hover:text-[#1a1a18]'
      }`}
    >
      {label}
      {count !== undefined ? <span className="ml-1 text-xs opacity-60">({count})</span> : null}
    </button>
  );
}

function AuroraCard({
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
      style={{ ['--reveal-delay' as string]: `${(index % 6) * 70}ms` }}
      className={muted ? 'opacity-60' : ''}
    >
      <button
        type="button"
        onClick={onQuickView}
        aria-label={`Quick view ${product.name}`}
        className="group block w-full text-left"
      >
        <div className="relative aspect-[4/5] overflow-hidden bg-[#efece4]">
          <ProductImage
            src={product.image}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            fallbackClassName="flex h-full w-full items-center justify-center font-serif text-6xl text-[#1a1a18]/25"
          />
          {muted ? (
            <span className="absolute left-3 top-3 border border-[#1a1a18]/20 bg-[#faf9f6]/90 px-2 py-1 text-[10px] uppercase tracking-[0.2em]">
              Out of stock
            </span>
          ) : null}
          <span className="absolute inset-x-0 bottom-0 translate-y-full bg-[#1a1a18]/85 py-2 text-center text-[11px] uppercase tracking-[0.25em] text-[#faf9f6] transition-transform duration-300 group-hover:translate-y-0">
            Quick view
          </span>
        </div>
        <div className="mt-4 border-t border-[#1a1a18]/10 pt-3">
          <h3 className="font-serif text-lg leading-snug tracking-tight">{product.name}</h3>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-[#1a1a18]/50">
              {product.brand ?? ' '}
            </p>
            <p className="text-sm">{formatPriceRange(product.price_min, product.price_max, currency)}</p>
          </div>
        </div>
      </button>
    </article>
  );
}

function AuroraSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-3 md:gap-x-8" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[4/5] bg-[#efece4]" />
          <div className="mt-4 h-4 w-2/3 bg-[#efece4]" />
          <div className="mt-2 h-3 w-1/3 bg-[#efece4]" />
        </div>
      ))}
    </div>
  );
}

function AuroraQuickView({
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
      <div className="relative aspect-[4/5] bg-[#efece4]">
        <ProductImage
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center font-serif text-8xl text-[#1a1a18]/25"
        />
      </div>
      <div className="flex flex-col p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-serif text-2xl tracking-tight">{product.name}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-2xl leading-none text-[#1a1a18]/50 transition-colors hover:text-[#1a1a18]"
          >
            ×
          </button>
        </div>
        {product.name_np ? <p className="mt-1 text-[#1a1a18]/60">{product.name_np}</p> : null}
        <hr className="my-5 border-t border-[#1a1a18]/15" />
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-[#1a1a18]/50">Brand</dt>
            <dd>{product.brand ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#1a1a18]/50">Code</dt>
            <dd>{product.code}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#1a1a18]/50">Availability</dt>
            <dd>{product.in_stock ? 'In stock' : 'Out of stock'}</dd>
          </div>
        </dl>
        <p className="mt-6 font-serif text-2xl tracking-tight">
          {formatPriceRange(product.price_min, product.price_max, currency)}
        </p>
        <div className="mt-auto pt-8">
          {phone ? (
            <a
              href={`tel:${phone}`}
              className="block border border-[#1a1a18] py-3 text-center text-xs uppercase tracking-[0.25em] transition-colors hover:bg-[#1a1a18] hover:text-[#faf9f6]"
            >
              Call to order · {phone}
            </a>
          ) : (
            <p className="text-center text-xs uppercase tracking-[0.25em] text-[#1a1a18]/50">
              Visit our store to order
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
