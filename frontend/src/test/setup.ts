import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; Radix primitives (Dialog, Popover) need one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

// Initialize the shared i18next instance for tests: English, synchronous
// (resources are bundled, so no backend/detector), mirroring src/lib/i18n.
// Tests assert the ENGLISH string — bilingual "EN / नेपाली" labels are gone.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/lib/i18n/en.json';
import ne from '@/lib/i18n/ne.json';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ne: { translation: ne },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
