import { ProductImage } from "../../components/ProductImage";
import { useRevealOnScroll } from "../../components/hooks";
import type { Product } from "../../lib/api";
import { offerBadge, productPriceDisplay } from "../../lib/money";

const ACCENT = "text-[#6d2b2b]";

export function AuroraChip({
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
          ? "border-[#6d2b2b] text-[#6d2b2b]"
          : "border-transparent text-[#1a1a18]/60 hover:text-[#1a1a18]"
      }`}
    >
      {label}
      {count !== undefined ? (
        <span className="ml-1 text-xs opacity-60">({count})</span>
      ) : null}
    </button>
  );
}

export function AuroraCard({
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
      style={{ ["--reveal-delay" as string]: `${(index % 6) * 70}ms` }}
      className={muted ? "opacity-60" : ""}
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
          {badge ? (
            <span className="absolute right-3 top-3 border border-[#6d2b2b]/30 bg-[#faf9f6]/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6d2b2b]">
              {badge}
            </span>
          ) : null}
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
          <h3 className="font-serif text-lg leading-snug tracking-tight">
            {product.name}
          </h3>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-[#1a1a18]/50">
              {product.brand ?? " "}
            </p>
            <p className="text-sm">
              {price.compareAt ? (
                <span className="mr-1.5 text-[#1a1a18]/40 line-through">
                  {price.compareAt}
                </span>
              ) : null}
              <span className={price.compareAt ? ACCENT : ""}>
                {price.text}
              </span>
            </p>
          </div>
        </div>
      </button>
    </article>
  );
}

export function AuroraRailCard({
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
      className="group w-40 shrink-0 snap-start text-left sm:w-48"
    >
      <div className="relative aspect-square overflow-hidden bg-[#efece4]">
        <ProductImage
          src={product.image}
          alt={product.name}
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
          fallbackClassName="flex h-full w-full items-center justify-center font-serif text-4xl text-[#1a1a18]/25"
        />
        {badge ? (
          <span className="absolute right-2 top-2 border border-[#6d2b2b]/30 bg-[#faf9f6]/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-[#6d2b2b]">
            {badge}
          </span>
        ) : null}
      </div>
      <h3 className="mt-2.5 truncate font-serif text-sm tracking-tight">
        {product.name}
      </h3>
      <p className="text-[13px] text-[#1a1a18]/70">
        {price.compareAt ? (
          <span className="mr-1 text-[11px] text-[#1a1a18]/40 line-through">
            {price.compareAt}
          </span>
        ) : null}
        <span className={price.compareAt ? ACCENT : ""}>{price.text}</span>
      </p>
    </button>
  );
}

export function AuroraSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-3 md:gap-x-8"
      aria-hidden="true"
    >
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

export function AuroraQuickView({
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
        {product.name_np ? (
          <p className="mt-1 text-[#1a1a18]/60">{product.name_np}</p>
        ) : null}
        <hr className="my-5 border-t border-[#1a1a18]/15" />
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-[#1a1a18]/50">Brand</dt>
            <dd>{product.brand ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#1a1a18]/50">Code</dt>
            <dd>{product.code}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#1a1a18]/50">Availability</dt>
            <dd>{product.in_stock ? "In stock" : "Out of stock"}</dd>
          </div>
        </dl>
        <p className="mt-6 font-serif text-2xl tracking-tight">
          {price.compareAt ? (
            <span className="mr-2 text-lg text-[#1a1a18]/40 line-through">
              {price.compareAt}
            </span>
          ) : null}
          <span className={price.compareAt ? ACCENT : ""}>{price.text}</span>
        </p>
        <div className="mt-auto pt-8">
          <a href={`/product/${product.id}`} className="block border border-[#1a1a18] py-3 text-center text-xs uppercase tracking-[0.25em] transition-colors hover:bg-[#1a1a18] hover:text-[#faf9f6]">Choose options</a>
          {phone ? <p className="mt-3 text-center text-xs text-[#1a1a18]/50">Questions? Call {phone}</p> : null}
        </div>
      </div>
    </div>
  );
}
