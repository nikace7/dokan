# Storefront — public online shop

The customer-facing ecommerce storefront for Dokan tenants. Shoppers browse
and search the catalog, choose a size/colour option, keep a persistent cart,
verify their email with a one-time code, place a COD pickup or delivery order,
and return to order history or a tokenized tracking page.

- Stack: Vite 6 · React 18 · TypeScript (strict) · Tailwind CSS 3 · Vitest.
- Data: same-origin storefront APIs for site/catalog, product detail, OTP
  authentication, idempotent order placement, customer history, and public
  token tracking (envelope `{ data, meta, error }`). Product images come from
  same-origin `/media/...` paths.
- Tenant-controlled content: the site payload's `store` block carries the
  shop's own hero title/subtitle, announcement, and offer (text + discount
  %). Products carry `website_price` (single online price, already
  discounted server-side) + `website_compare_at`; when absent the templates
  fall back to the `price_min`–`price_max` range. All money math happens
  server-side — templates only format (`lib/money.ts`).

## Commands

```bash
npm install       # once — creates package-lock.json (CI uses npm ci)
npm run dev       # Vite dev server; open http://demo.shop.localhost:5173 (proxies /api, /media → :8000)
npm test          # vitest run (jsdom)
npm run lint      # eslint .
npm run build     # tsc --noEmit && vite build → dist/
```

## Templates

The backend picks the visual template per tenant (`site.template` in the
site payload). The registry lives in `src/templates/index.ts`:

```ts
export const TEMPLATES: Record<string, ComponentType<TemplateProps>> = {
  aurora: AuroraTemplate,   // premium minimal boutique
  bazaar: BazaarTemplate,   // refined grand-bazaar elegance (emerald/brass)
};
export const DEFAULT_TEMPLATE = 'aurora';
```

`src/App.tsx` fetches the site info, then routes the catalog through
`TEMPLATES[site.template] ?? TEMPLATES[DEFAULT_TEMPLATE]` (unknown keys fall
back to aurora). Commerce routes (`/product/:id`, `/cart`, `/checkout`,
`/orders`, `/order/:token`) share `CommerceProvider`; only customer tokens and
cart contents persist in browser storage. Each template owns its catalog page: header, hero, category
chips, debounced search, product grid with "Load more", quick-view modal,
and footer. Shared, look-agnostic pieces (API client, money formatting,
`useProducts`, `useDebouncedValue`, `useRevealOnScroll`, `QuickViewModal`,
`ProductImage`) live in `src/lib/` and `src/components/`.

Checkout supports COD only. The API rejects `ONLINE` until a verified gateway
is connected; the UI does not advertise or simulate an unavailable payment.
Stock is reserved by active online orders and is posted to the immutable stock
ledger only when staff complete the linked POS bill.

## Adding a new template

1. Create `src/templates/<name>/<Name>Template.tsx` implementing the full
   page for `TemplateProps = { site: SiteInfo }` — reuse the shared hooks and
   primitives, but give it a genuinely distinct visual identity.
2. Register it in `TEMPLATES` (`src/templates/index.ts`) with a stable key.
3. Add a render smoke test (`src/templates/<name>/<name>.test.tsx`) with
   fetch mocked, mirroring the aurora/bazaar tests.
4. The tenant's `template` value (set in the platform admin) can then use
   the new key — no other wiring needed.

## Docker

Multi-stage build (`node:20-alpine` → `nginxinc/nginx-unprivileged`) serving
the static SPA on port 8080; see `Dockerfile` and `nginx.conf` (SPA fallback
to index.html, long-cache `/assets`, `no-store` for the shell and
`/version.json`).
