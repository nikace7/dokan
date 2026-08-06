import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import ne from './ne.json';

/**
 * UI language: one language at a time (English or नेपाली), switched from the
 * header/login toggle. Printed receipts stay bilingual by design and do NOT
 * go through i18n.
 *
 * Key convention (keep both files in sync, follow-up slices must match):
 *   - nested by surface: `nav.*`, `auth.*`, `billing.*`, `simpleSale.*`,
 *     `share.*`, `sharedBill.*`, `support.*`, `common.*`
 *   - interpolation uses `{{var}}`; plurals use i18next `_one`/`_other`
 *   - Nepali wording reuses the strings that were already on screen.
 */

export const SUPPORTED_LANGUAGES = ['en', 'ne'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** localStorage key the detector reads/writes. */
export const STORAGE_KEY = 'dokan-lang';

/**
 * First-run language. The primary users are Nepali shopkeepers, so a browser
 * with no stored choice gets Nepali. Change here to flip the default.
 */
export const DEFAULT_LANGUAGE: Language = 'ne';

export const resources = {
  en: { translation: en },
  ne: { translation: ne },
} as const;

function storedLanguage(): Language | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'en' || value === 'ne' ? value : null;
  } catch {
    return null;
  }
}

function syncLangAttribute(lng: string): void {
  document.documentElement.lang = lng.startsWith('ne') ? 'ne' : 'en';
}

// An explicit `lng` wins over the detector's detection in i18next, so we read
// the stored choice ourselves to guarantee DEFAULT_LANGUAGE on first run
// (navigator alone must not land a Nepali shopkeeper on English). The
// detector plugin is still attached for its localStorage cache — every
// changeLanguage persists to STORAGE_KEY.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: storedLanguage() ?? DEFAULT_LANGUAGE,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  })
  .then(() => syncLangAttribute(i18n.language));

i18n.on('languageChanged', syncLangAttribute);

export default i18n;
