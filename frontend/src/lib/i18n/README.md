# `src/lib/i18n` — UI language (English / नेपाली)

The UI shows **one language at a time**, switched with the `LanguageToggle`
(header, login page). Choice persists in `localStorage["dokan-lang"]`; first
run defaults to Nepali (`DEFAULT_LANGUAGE` in `index.ts`). Printed 80mm
receipts and the on-screen receipt body stay **bilingual by design** and do
not go through i18n.

## Adding strings

- Keys are nested by surface: `nav.*`, `auth.*`, `billing.*`, `simpleSale.*`,
  `share.*`, `sharedBill.*`, `support.*`, plus `common.*` for reusable bits.
  New feature slices add a top-level namespace matching the feature
  (`customers.*`, `inventory.*`, …).
- Every key exists in **both** `en.json` and `ne.json` — keep them in sync in
  the same PR.
- Nepali wording should reuse strings that already shipped (grep the diff
  history / removed bilingual labels) so the vocabulary stays consistent.
- Interpolation: `t('billing.noItemMatches', { code })` → `{{code}}` in the
  JSON. Plurals: i18next `_one` / `_other` suffixes with `{ count }`.
- Components use `useTranslation()`; pure TS modules (e.g.
  `simpleSaleModel.ts`) import the shared instance with `import i18n from
'i18next'` and call `i18n.t(...)`. Only `app/main.tsx` may import
  `@/lib/i18n` (it initializes the app config incl. the Nepali default);
  tests initialize the same global instance in `src/test/setup.ts`.

## Tests

`src/test/setup.ts` initializes the same instance with `lng: 'en'`, so tests
assert **English** strings. Never assert on a bilingual `"EN / नेपाली"`
literal — those are gone.
