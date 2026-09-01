import { describe, expect, it } from 'vitest';

import {
  adToBs,
  bsToAd,
  daysInBsMonth,
  fiscalYearBs,
  formatBs,
  parseBsString,
  toBsString,
} from './index';

// Known pair verified against the installed library (nepali-date-converter
// 3.4.0): AD 2000-01-01 === BS 2056-09-17 (17 Poush 2056).
const KNOWN_PAIR = { ad: '2000-01-01', bs: { year: 2056, month: 9, day: 17 } } as const;

describe('adToBs', () => {
  it('converts the known pair AD 2000-01-01 → BS 2056-09-17', () => {
    expect(adToBs(KNOWN_PAIR.ad)).toEqual(KNOWN_PAIR.bs);
  });

  it('rejects malformed input', () => {
    expect(() => adToBs('01/01/2000')).toThrow('Expected an AD ISO date');
    expect(() => adToBs('not a date')).toThrow('Expected an AD ISO date');
  });

  it('rejects dates outside the supported table range', () => {
    // Before BS 2000-01-01 (= AD 1943-04-14).
    expect(() => adToBs('1900-01-01')).toThrow('outside the supported BS range');
  });
});

describe('bsToAd', () => {
  it('converts the known pair BS 2056-09-17 → AD 2000-01-01', () => {
    expect(bsToAd(KNOWN_PAIR.bs)).toBe(KNOWN_PAIR.ad);
  });

  it('rejects out-of-range BS dates with a clear error', () => {
    expect(() => bsToAd({ year: 1970, month: 1, day: 1 })).toThrow(
      'Invalid or unsupported BS date',
    );
    expect(() => bsToAd({ year: 2100, month: 12, day: 30 })).toThrow(
      'Invalid or unsupported BS date',
    );
  });
});

describe('round-trip', () => {
  it('AD → BS → AD is the identity across the supported range', () => {
    const samples = ['2000-01-01', '2025-07-27', '2026-04-14', '2033-03-31'];
    for (const ad of samples) {
      expect(bsToAd(adToBs(ad))).toBe(ad);
    }
  });
});

describe('formatting', () => {
  it('zero-pads and sorts lexicographically', () => {
    expect(toBsString({ year: 2082, month: 4, day: 2 })).toBe('2082-04-02');
  });

  it('renders Devanagari numerals on request', () => {
    expect(formatBs({ year: 2082, month: 4, day: 12 }, { devanagari: true })).toBe('२०८२-०४-१२');
    expect(formatBs({ year: 2082, month: 4, day: 12 })).toBe('2082-04-12');
  });

  it('parses only real dates from the supported BS calendar', () => {
    expect(parseBsString('2083-04-20')).toEqual({ year: 2083, month: 4, day: 20 });
    expect(() => parseBsString('2083-13-01')).toThrow('Invalid BS date');
    expect(() => parseBsString('2083-04-99')).toThrow('Invalid BS date');
  });

  it('derives month length from the canonical conversion table', () => {
    expect(daysInBsMonth(2083, 4)).toBeGreaterThanOrEqual(29);
    expect(daysInBsMonth(2083, 4)).toBeLessThanOrEqual(32);
    expect(() => parseBsString(`2083-04-${daysInBsMonth(2083, 4) + 1}`)).toThrow('Invalid BS date');
  });
});

describe('fiscalYearBs — Shrawan 1 → Ashad end', () => {
  it('Shrawan (month 4) starts a new fiscal year', () => {
    expect(fiscalYearBs({ year: 2082, month: 4, day: 1 })).toBe('2082-83');
    expect(fiscalYearBs({ year: 2082, month: 12, day: 30 })).toBe('2082-83');
  });

  it('Baisakh–Ashad (months 1–3) belong to the previous fiscal year', () => {
    expect(fiscalYearBs({ year: 2083, month: 1, day: 1 })).toBe('2082-83');
    expect(fiscalYearBs({ year: 2083, month: 3, day: 32 })).toBe('2082-83');
  });

  it('rejects invalid months', () => {
    expect(() => fiscalYearBs({ year: 2082, month: 13, day: 1 })).toThrow('Invalid BS month');
  });
});
