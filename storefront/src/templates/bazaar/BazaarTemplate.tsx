import { useState } from "react";

import { QuickViewModal } from "../../components/QuickViewModal";
import { OfferPopup } from "../../components/OfferPopup";
import { useDebouncedValue, useScrolledPast } from "../../components/hooks";
import { useFeaturedProducts } from "../../components/useFeaturedProducts";
import { useProducts } from "../../components/useProducts";
import type { Product, SiteCategory } from "../../lib/api";
import { offerCountdown, offerLabel } from "../../lib/money";
import type { TemplateProps } from "..";
import {
  BazaarCard,
  BazaarPill,
  BazaarQuickView,
  BazaarRailCard,
  BazaarSkeleton,
} from "./BazaarComponents";
import { BazaarHero } from "./BazaarHero";

const INK = "text-[#17241f]";
const ACCENT = "text-[#a5812e]";

const MARQUEE_ITEMS = [
  "New arrivals",
  "Genuine brands",
  "Fair prices",
  "Visit us in store",
];

export function BazaarTemplate({ site }: TemplateProps) {
  const scrolled = useScrolledPast(24);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const {
    products,
    meta,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    retry,
  } = useProducts(category, debouncedSearch);
  const [quickView, setQuickView] = useState<Product | null>(null);
  const { products: featured } = useFeaturedProducts();

  const heroProduct = products[0] ?? null;
  const heroSecond = products[1] ?? null;
  const offer = offerLabel(site.store);
  const countdown = offerCountdown(site.store.offer_ends_at);
  const offerLine = [offer, countdown].filter(Boolean).join(" · ");
  const marqueeItems = site.store.announcement
    ? [site.store.announcement]
    : MARQUEE_ITEMS;
  // The featured rail only makes sense on the unfiltered storefront.
  const showRail = !category && !debouncedSearch && featured.length > 0;

  return (
    <div className={`min-h-screen bg-[#f7f3eb] font-sans ${INK} antialiased`}>
      <BazaarHero
        site={site}
        scrolled={scrolled}
        heroProduct={heroProduct}
        heroSecond={heroSecond}
        offerLine={offerLine}
        marqueeItems={marqueeItems}
      />

      {/* Promo banners — the tenant's own cards, hidden when none are set. */}
      {site.store.banners.length > 0 ? (
        <section
          className="mx-auto max-w-6xl px-5 pt-12"
          aria-label="Offers and notices"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {site.store.banners.map((banner) => {
              const card = (
                <div className="h-full rounded-[1.25rem] border border-[#c9a84c]/30 bg-[#fffdf8] p-5 shadow-[0_1px_3px_rgba(23,36,31,0.08)] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_32px_-20px_rgba(23,36,31,0.35)]">
                  <div
                    className="h-0.5 w-8 bg-[#c9a84c]/70"
                    aria-hidden="true"
                  />
                  <h3 className="mt-3 font-serif text-lg tracking-tight">
                    {banner.title}
                  </h3>
                  {banner.text ? (
                    <p className="mt-1 text-sm leading-relaxed text-[#17241f]/65">
                      {banner.text}
                    </p>
                  ) : null}
                  {banner.cta_text ? (
                    <p
                      className={`mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] ${ACCENT}`}
                    >
                      {banner.cta_text} →
                    </p>
                  ) : null}
                </div>
              );
              return banner.cta_link ? (
                <a
                  key={banner.title}
                  href={banner.cta_link}
                  className="group block h-full"
                >
                  {card}
                </a>
              ) : (
                <div key={banner.title} className="group h-full">
                  {card}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Featured rail — the shop's hand-picked pieces, unfiltered view only. */}
      {showRail ? (
        <section
          aria-label="Featured pieces"
          className="mx-auto max-w-6xl px-5 pt-14"
        >
          <div className="mb-6 flex items-baseline gap-4">
            <h2 className="font-serif text-2xl tracking-tight">
              Featured pieces
            </h2>
            <span className="h-px flex-1 bg-[#c9a84c]/40" aria-hidden="true" />
          </div>
          <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2">
            {featured.slice(0, 10).map((product) => (
              <BazaarRailCard
                key={product.id}
                product={product}
                currency={site.currency}
                onQuickView={() => setQuickView(product)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Collection */}
      <main id="shop" className="mx-auto max-w-6xl px-5 pb-24 pt-14">
        <div className="mb-10 flex flex-col gap-6 border-b border-[#17241f]/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-serif text-3xl tracking-tight sm:text-4xl">
              The Collection
            </h2>
            <p className="mt-1 text-xs uppercase tracking-[0.25em] text-[#17241f]/50">
              {meta ? `${meta.count} pieces` : "Browse everything"}
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
          <BazaarPill
            active={category === null}
            onClick={() => setCategory(null)}
            label="All"
          />
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
            <p className="font-serif text-2xl text-[#17241f]/70">
              Nothing matches that search
            </p>
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
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </main>

      <footer className="border-t border-[#c9a84c]/20 bg-[#17241f] text-[#f7f3eb]">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-14 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-serif text-2xl tracking-tight">
              {site.shop_name}
            </p>
            <div
              className="mt-2 h-px w-12 bg-[#c9a84c]/60"
              aria-hidden="true"
            />
            {site.contact.address ? (
              <p className="mt-3 text-sm text-[#f7f3eb]/60">
                {site.contact.address}
              </p>
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
        label={quickView?.name ?? "Product details"}
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

      <OfferPopup
        popup={site.store.popup}
        backdropClassName="fixed inset-0 z-50 flex items-end justify-center bg-[#17241f]/50 backdrop-blur-sm sm:items-center sm:p-6"
        panelClassName="w-full max-w-md overflow-hidden rounded-t-[1.75rem] bg-[#f7f3eb] shadow-2xl outline-none motion-safe:animate-[bazaar-slide-up_0.25s_ease-out] sm:rounded-[1.75rem] sm:motion-safe:animate-[bazaar-pop_0.3s_ease-out]"
      >
        {(close) => (
          <div className="relative p-8 text-center sm:p-10">
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#17241f]/5 text-xl leading-none text-[#17241f] transition-transform hover:scale-105"
            >
              ×
            </button>
            <div
              className="mx-auto h-0.5 w-10 bg-[#c9a84c]/70"
              aria-hidden="true"
            />
            <h2 className="mt-4 font-serif text-2xl tracking-tight sm:text-3xl">
              {site.store.popup?.title}
            </h2>
            {site.store.popup?.text ? (
              <p className="mt-3 text-sm leading-relaxed text-[#17241f]/70">
                {site.store.popup.text}
              </p>
            ) : null}
            {site.store.popup?.cta_text ? (
              <a
                href={site.store.popup.cta_link || "#shop"}
                onClick={close}
                className="mt-6 inline-block rounded-full bg-[#17241f] px-7 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#f7f3eb] transition-colors hover:bg-[#24382f]"
              >
                {site.store.popup.cta_text}
              </a>
            ) : null}
          </div>
        )}
      </OfferPopup>
    </div>
  );
}
