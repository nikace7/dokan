import { ProductImage } from "../../components/ProductImage";
import { useRevealOnScroll } from "../../components/hooks";
import type { Product } from "../../lib/api";
import { offerBadge, productPriceDisplay } from "../../lib/money";

const ACCENT = "text-[#a5812e]";

export function BazaarPill({
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
          ? "bg-[#17241f] text-[#f7f3eb] shadow-md"
          : "border border-[#17241f]/15 bg-[#fffdf8]/70 text-[#17241f]/70 hover:border-[#17241f]/40 hover:text-[#17241f]"
      }`}
    >
      {label}
      {count !== undefined ? (
        <span
          className={`ml-1.5 ${active ? "text-[#c9a84c]" : "text-[#17241f]/40"}`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function BazaarCard({
  product,
  currency,
  index,
  onQuickView,
}: {
  product: Product;
  currency: "NPR" | "INR";
  index: number;
  onQuickView: () => void;
}) {
  const { ref, visible } = useRevealOnScroll<HTMLElement>();
  const muted = !product.in_stock;
  const price = productPriceDisplay(product, currency);
  const badge = offerBadge(product);
  return (
    <article
      ref={ref}
      data-reveal={visible ? "visible" : undefined}
      style={{ ["--reveal-delay" as string]: `${(index % 6) * 60}ms` }}
      className={muted ? "opacity-70" : ""}
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
          {badge ? (
            <span className="absolute right-3 top-3 rounded-full bg-[#a5812e] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-[#fffdf8] shadow-sm">
              {badge}
            </span>
          ) : null}
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
          <h3 className="font-serif text-lg leading-snug tracking-tight">
            {product.name}
          </h3>
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <p className="truncate text-[11px] uppercase tracking-[0.18em] text-[#17241f]/45">
              {product.brand ?? " "}
            </p>
            <p className="shrink-0 font-serif text-[15px]">
              {price.compareAt ? (
                <span className="mr-1.5 text-[13px] text-[#17241f]/40 line-through">
                  {price.compareAt}
                </span>
              ) : null}
              <span className={price.compareAt ? "text-[#8c2f2f]" : ""}>
                {price.text}
              </span>
            </p>
          </div>
        </div>
      </button>
    </article>
  );
}

export function BazaarRailCard({
  product,
  currency,
  onQuickView,
}: {
  product: Product;
  currency: "NPR" | "INR";
  onQuickView: () => void;
}) {
  const price = productPriceDisplay(product, currency);
  const badge = offerBadge(product);
  return (
    <button
      type="button"
      onClick={onQuickView}
      aria-label={`Quick view ${product.name}`}
      className="group w-40 shrink-0 snap-start rounded-[1.1rem] bg-[#fffdf8] p-2.5 text-left ring-1 ring-[#17241f]/5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-20px_rgba(23,36,31,0.35)] sm:w-48"
    >
      <div className="relative aspect-square overflow-hidden rounded-[0.8rem] bg-[#ece5d8]">
        <ProductImage
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
          fallbackClassName="flex h-full w-full items-center justify-center font-serif text-4xl text-[#17241f]/20"
        />
        {badge ? (
          <span className="absolute right-2 top-2 rounded-full bg-[#a5812e] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#fffdf8]">
            {badge}
          </span>
        ) : null}
      </div>
      <h3 className="mt-2.5 truncate px-1 font-serif text-sm tracking-tight">
        {product.name}
      </h3>
      <p className="px-1 pb-1 font-serif text-[13px] text-[#17241f]/75">
        {price.compareAt ? (
          <span className="mr-1 text-[11px] text-[#17241f]/40 line-through">
            {price.compareAt}
          </span>
        ) : null}
        <span className={price.compareAt ? "text-[#8c2f2f]" : ""}>
          {price.text}
        </span>
      </p>
    </button>
  );
}

export function BazaarSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3"
      aria-hidden="true"
    >
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

export function BazaarQuickView({
  product,
  currency,
  phone,
  onClose,
}: {
  product: Product;
  currency: "NPR" | "INR";
  phone: string | null;
  onClose: () => void;
}) {
  const price = productPriceDisplay(product, currency);
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
          {product.brand ?? "Unbranded"}
        </p>
        <h3 className="mt-1 font-serif text-2xl tracking-tight sm:text-3xl">
          {product.name}
        </h3>
        {product.name_np ? (
          <p className="mt-1 text-[#17241f]/60">{product.name_np}</p>
        ) : null}
        <div className="my-5 h-px w-12 bg-[#c9a84c]/60" aria-hidden="true" />
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between border-b border-[#17241f]/10 pb-2">
            <dt className="text-[#17241f]/50">Code</dt>
            <dd>{product.code}</dd>
          </div>
          <div className="flex justify-between border-b border-[#17241f]/10 pb-2">
            <dt className="text-[#17241f]/50">Category</dt>
            <dd>{product.category ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#17241f]/50">Availability</dt>
            <dd
              className={product.in_stock ? "text-[#2f5d4a]" : "text-[#8c2f2f]"}
            >
              {product.in_stock ? "In stock" : "Out of stock"}
            </dd>
          </div>
        </dl>
        <p className="mt-6 font-serif text-2xl tracking-tight sm:text-3xl">
          {price.compareAt ? (
            <span className="mr-2 text-lg text-[#17241f]/40 line-through">
              {price.compareAt}
            </span>
          ) : null}
          <span className={price.compareAt ? "text-[#8c2f2f]" : ""}>
            {price.text}
          </span>
        </p>
        <div className="mt-auto pt-7">
          <a href={`/product/${product.id}`} className="block rounded-full bg-[#17241f] py-3.5 text-center text-xs font-semibold uppercase tracking-[0.25em] text-[#f7f3eb] transition-colors hover:bg-[#24382f]">Choose options</a>
          {phone ? <p className="mt-3 text-center text-xs text-[#17241f]/50">Questions? Call {phone}</p> : null}
        </div>
      </div>
    </div>
  );
}
