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
  AuroraCard,
  AuroraChip,
  AuroraQuickView,
  AuroraRailCard,
  AuroraSkeleton,
} from "./AuroraComponents";

const INK = "text-[#1a1a18]";
const ACCENT = "text-[#6d2b2b]";

/**
 * Aurora — premium minimal boutique. Ivory/charcoal, serif display type,
 * hairline rules, editorial grid with quiet hover reveals.
 */
export function AuroraTemplate({ site }: TemplateProps) {
  const scrolled = useScrolledPast(40);
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
  const offer = offerLabel(site.store);
  const countdown = offerCountdown(site.store.offer_ends_at);
  const offerLine = [offer, countdown].filter(Boolean).join(" · ");
  // The featured rail only makes sense on the unfiltered storefront.
  const showRail = !category && !debouncedSearch && featured.length > 0;

  return (
    <div className={`min-h-screen bg-[#faf9f6] font-sans ${INK} antialiased`}>
      {/* Slim sticky header — gains a hairline + blur after scrolling. */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
          scrolled
            ? "border-b border-[#1a1a18]/10 bg-[#faf9f6]/85 backdrop-blur-md"
            : "border-b border-transparent"
        }`}
      >
        {site.store.announcement ? (
          <div className="bg-[#1a1a18] px-4 py-1.5 text-center text-[11px] uppercase tracking-[0.25em] text-[#faf9f6]">
            {site.store.announcement}
          </div>
        ) : null}
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
      <section
        id="top"
        className="relative flex min-h-[92vh] items-center overflow-hidden"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,#efe9dd_0%,#faf9f6_55%)] motion-safe:animate-[aurora-drift_24s_ease-in-out_infinite]"
        />
        <div className="relative mx-auto w-full max-w-6xl px-5 pt-20">
          <p className={`mb-6 text-xs uppercase tracking-[0.35em] ${ACCENT}`}>
            Est. in Nepal · Curated clothing
          </p>
          <h1 className="font-serif text-[13vw] leading-[0.95] tracking-tight sm:text-7xl lg:text-8xl">
            {site.store.hero_title || site.shop_name}
          </h1>
          {site.shop_name_np ? (
            <p className="mt-4 font-serif text-2xl text-[#1a1a18]/60">
              {site.shop_name_np}
            </p>
          ) : null}
          {offerLine ? (
            <p
              className={`mt-6 inline-block border border-[#6d2b2b]/40 px-4 py-1.5 text-xs uppercase tracking-[0.25em] ${ACCENT}`}
            >
              {offerLine}
            </p>
          ) : null}
          <hr className="my-8 w-24 border-t border-[#1a1a18]/30" />
          <p className="max-w-md text-sm leading-relaxed text-[#1a1a18]/70">
            {site.store.hero_subtitle ||
              "A quiet edit of everyday clothing — genuine brands, honest prices. Browse the collection, then visit us in store."}
          </p>
        </div>
        <a
          href="#collection"
          aria-label="Scroll to the collection"
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[#1a1a18]/60 motion-safe:animate-[aurora-cue_2.2s_ease-in-out_infinite]"
        >
          <svg
            width="20"
            height="28"
            viewBox="0 0 20 28"
            fill="none"
            aria-hidden="true"
          >
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

      {/* Promo banners — the tenant's own cards, hidden when none are set. */}
      {site.store.banners.length > 0 ? (
        <section
          className="mx-auto max-w-6xl px-5 pt-12"
          aria-label="Offers and notices"
        >
          <div className="grid gap-px border border-[#1a1a18]/15 bg-[#1a1a18]/15 sm:grid-cols-2 lg:grid-cols-3">
            {site.store.banners.map((banner) => {
              const card = (
                <div className="h-full bg-[#faf9f6] p-6 transition-colors group-hover:bg-[#f3f0e8]">
                  <h3 className="font-serif text-lg tracking-tight">
                    {banner.title}
                  </h3>
                  {banner.text ? (
                    <p className="mt-2 text-sm leading-relaxed text-[#1a1a18]/65">
                      {banner.text}
                    </p>
                  ) : null}
                  {banner.cta_text ? (
                    <p
                      className={`mt-3 text-[11px] uppercase tracking-[0.25em] ${ACCENT}`}
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
          className="mx-auto max-w-6xl px-5 pt-16"
        >
          <div className="mb-6 flex items-baseline gap-4 border-b border-[#1a1a18]/15 pb-4">
            <h2 className="font-serif text-2xl tracking-tight">Featured</h2>
            <span className="text-xs uppercase tracking-[0.25em] text-[#1a1a18]/50">
              Hand-picked
            </span>
          </div>
          <div className="-mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-2">
            {featured.slice(0, 10).map((product) => (
              <AuroraRailCard
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
      <main id="collection" className="mx-auto max-w-6xl px-5 pb-24 pt-16">
        <div className="mb-10 flex flex-col gap-6 border-b border-[#1a1a18]/15 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-serif text-3xl tracking-tight">
              The Collection
            </h2>
            <p className="mt-1 text-xs uppercase tracking-[0.25em] text-[#1a1a18]/50">
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
              className="w-full border-b border-[#1a1a18]/25 bg-transparent py-2 text-sm outline-none transition-colors placeholder:text-[#1a1a18]/40 focus:border-[#6d2b2b]"
            />
          </label>
        </div>

        {/* Category chips */}
        <div
          className="mb-12 flex flex-wrap gap-x-6 gap-y-2"
          role="list"
          aria-label="Categories"
        >
          <AuroraChip
            active={category === null}
            onClick={() => setCategory(null)}
            label="All"
          />
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
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </main>

      <footer className="bg-[#1a1a18] text-[#faf9f6]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-14 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-serif text-2xl tracking-tight">
              {site.shop_name}
            </p>
            {site.contact.address ? (
              <p className="mt-2 text-sm text-[#faf9f6]/60">
                {site.contact.address}
              </p>
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
        label={quickView?.name ?? "Product details"}
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

      <OfferPopup
        popup={site.store.popup}
        backdropClassName="fixed inset-0 z-50 flex items-center justify-center bg-[#1a1a18]/40 p-4 backdrop-blur-sm"
        panelClassName="w-full max-w-md border border-[#1a1a18]/15 bg-[#faf9f6] shadow-2xl outline-none"
      >
        {(close) => (
          <div className="relative p-8 text-center sm:p-10">
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-3 top-3 text-2xl leading-none text-[#1a1a18]/50 transition-colors hover:text-[#1a1a18]"
            >
              ×
            </button>
            <h2 className="font-serif text-2xl tracking-tight sm:text-3xl">
              {site.store.popup?.title}
            </h2>
            <hr
              className="mx-auto my-5 w-12 border-t border-[#1a1a18]/30"
              aria-hidden="true"
            />
            {site.store.popup?.text ? (
              <p className="text-sm leading-relaxed text-[#1a1a18]/70">
                {site.store.popup.text}
              </p>
            ) : null}
            {site.store.popup?.cta_text ? (
              <a
                href={site.store.popup.cta_link || "#collection"}
                onClick={close}
                className="mt-6 inline-block border border-[#1a1a18] px-7 py-3 text-xs uppercase tracking-[0.25em] transition-colors hover:bg-[#1a1a18] hover:text-[#faf9f6]"
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
