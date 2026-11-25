import i18n from 'i18next';

import { adToBs, bsToAd, parseBsString, toBsString } from '@/lib/bs';

const SHOP_TIME_ZONE = 'Asia/Kathmandu';

/** Typed dates before this are AD dates by mistake: BS 2026 is AD 1969. */
const OLDEST_TYPED_AD = '2000-01-01';

/** The shop's AD date now (or at `at`), whatever the device's time zone. */
export function shopAdDate(at = new Date()): string {
  return at.toLocaleDateString('en-CA', { timeZone: SHOP_TIME_ZONE });
}

/** AD ISO date → `2083-08-10`. Dates outside the BS tables stay as stored. */
export function adToBsText(ad: string): string {
  try {
    return toBsString(adToBs(ad));
  } catch {
    return ad;
  }
}

/** Typed BS date → AD ISO date, `''` when empty, null when unreadable. */
export function bsTextToAd(text: string): string | null {
  if (text.trim() === '') return '';
  try {
    const ad = bsToAd(parseBsString(text));
    return ad < OLDEST_TYPED_AD ? null : ad;
  } catch {
    return null;
  }
}

/** Shop clock time in the chosen language: `3:45 PM`, or `15:45` in Nepali. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(i18n.language === 'ne' ? 'ne-NP-u-nu-latn' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: SHOP_TIME_ZONE,
  });
}

/** BS date and shop clock time: `2083-08-10, 3:45 PM`. */
export function formatDateTime(iso: string): string {
  return `${adToBsText(shopAdDate(new Date(iso)))}, ${formatTime(iso)}`;
}
