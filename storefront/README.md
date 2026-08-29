# Storefront — public online shop

The customer-facing, anonymous, read-only storefront for Dokan tenants. A
shop's customers browse products by category/search, view prices and stock,
and call the store to order. No login, no cart (yet).

- Stack: Vite 6 · React 18 · TypeScript (strict) · Tailwind CSS 3 · Vitest.
- Data: same-origin fetches of `GET /api/v1/storefront/site` and
  `GET /api/v1/storefront/products` (envelope `{ data, meta, error }`).
  Product images come from same-origin `/media/...` paths.

## Commands

```bash
npm install       # once — creates package-lock.json (CI uses npm ci)
npm run dev       # Vite dev server; proxies /api and /media → http://localhost:8000
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

`src/App.tsx` fetches the site info, then renders
`TEMPLATES[site.template] ?? TEMPLATES[DEFAULT_TEMPLATE]` (unknown keys fall
back to aurora). Each template owns its entire page: header, hero, category
chips, debounced search, product grid with "Load more", quick-view modal,
and footer. Shared, look-agnostic pieces (API client, money formatting,
`useProducts`, `useDebouncedValue`, `useRevealOnScroll`, `QuickViewModal`,
`ProductImage`) live in `src/lib/` and `src/components/`.

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
