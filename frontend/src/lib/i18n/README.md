# `src/lib/i18n` — bilingual UI (placeholder, not built yet)

The UI is bilingual **Nepali + English**: Nepali labels on counter-facing
screens, optional Devanagari numerals (AGENTS.md "Language and localization";
docs/SYSTEM_DESIGN.md §6.4, §7).

Decisions deferred to the first feature PR that needs translated strings:

- library choice (a tiny typed message map is likely enough — the string
  count is small and counter screens are fixed),
- message file layout (per-feature vs. central),
- how `tenant.calendar_pref` / locale / numeral prefs flow in from settings.

What already exists today:

- `src/lib/money.ts` — Devanagari numeral option for money display.
- `src/lib/bs/` — `formatBs(..., { devanagari: true })` for BS dates.

Do not scaffold an i18n framework before a real screen needs it.
