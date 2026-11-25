import i18n from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';

import { adToBsText, bsTextToAd, formatDateTime, formatTime } from '@/lib/dateTime';

afterEach(() => i18n.changeLanguage('en'));

describe('shop dates', () => {
  it.each([
    ['2026-08-03', '2083-04-18'],
    ['', ''],
    ['2050-01-01', '2050-01-01'], // beyond the BS tables: shown as stored
  ])('shows %j as %j', (ad, bs) => {
    expect(adToBsText(ad)).toBe(bs);
  });

  it.each([
    ['2083-04-18', '2026-08-03'],
    [' ', ''],
    ['2083-04', null],
    ['2083-13-01', null],
    ['2026-08-03', null], // an AD date by habit: as BS it would be 1969
  ])('reads %j as %j', (text, ad) => {
    expect(bsTextToAd(text)).toBe(ad);
  });

  it('uses the shop clock, not the device clock', async () => {
    // 20:00 UTC is already the next day in Kathmandu.
    expect(formatDateTime('2026-08-02T20:00:00Z')).toBe('2083-04-18, 1:45 AM');
    await i18n.changeLanguage('ne');
    expect(formatTime('2026-08-02T10:00:00Z')).toBe('15:45');
  });
});
