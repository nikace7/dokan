import { ProductImage } from "../../components/ProductImage";
import type { Product, SiteInfo } from "../../lib/api";

const ACCENT = "text-[#a5812e]";

interface BazaarHeroProps {
  site: SiteInfo;
  scrolled: boolean;
  heroProduct: Product | null;
  heroSecond: Product | null;
  offerLine: string;
  marqueeItems: string[];
}

export function BazaarHero({
  site,
  scrolled,
  heroProduct,
  heroSecond,
  offerLine,
  marqueeItems,
}: BazaarHeroProps) {
  return (
    <>
      {/* Fixed header — gains a hairline + blur once the hero scrolls away. */}
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-all duration-300 ${
          scrolled
            ? "border-b border-[#17241f]/10 bg-[#f7f3eb]/85 backdrop-blur-md"
            : "border-b border-transparent"
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
      <section
        id="top"
        className="relative overflow-hidden pb-16 pt-28 sm:pt-32"
      >
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
            <p
              className={`flex items-center gap-3 text-xs uppercase tracking-[0.3em] ${ACCENT}`}
            >
              <span className="h-px w-8 bg-[#a5812e]/60" aria-hidden="true" />
              Online store
            </p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
              {site.store.hero_title || site.shop_name}
            </h1>
            {site.shop_name_np ? (
              <p className="mt-3 font-serif text-2xl text-[#17241f]/55">
                {site.shop_name_np}
              </p>
            ) : null}
            {offerLine ? (
              <p
                className={`mt-6 inline-block rounded-full border border-[#a5812e]/50 bg-[#c9a84c]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] ${ACCENT}`}
              >
                {offerLine}
              </p>
            ) : null}
            <p className="mt-6 max-w-md text-sm leading-relaxed text-[#17241f]/70 sm:text-base">
              {site.store.hero_subtitle ||
                "A hand-picked rail of genuine clothing at honest prices. Browse the collection online — then call us or visit the store to take it home."}
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
              {marqueeItems.map((item) => (
                <span
                  key={`${copy}-${item}`}
                  className="mx-8 flex items-center gap-16"
                >
                  {item}
                  <span className="text-[#c9a84c]">✦</span>
                </span>
              ))}
            </span>
          ))}
        </div>
        <span className="sr-only">{marqueeItems.join(" · ")}</span>
      </div>
    </>
  );
}
