import { describe, expect, it } from 'vitest';

import { adToBs, bsToAd, BsDateError, toBsString } from '@/lib/bs';
import type { BsDate } from '@/lib/bs';
import golden from './golden.json';

/**
 * Golden AD↔BS fixture test — the two conversion tables (backend
 * `nepali-datetime`, frontend `nepali-date-converter`) must never silently
 * diverge. `golden.json` derives from the backend's
 * `core/tests/fixtures/bs_golden.json`:
 *
 * - `inRange` (~130 pairs both tables agree on, spread across BS
 *   2000–2090 with month boundaries and the supported-range edges) are
 *   asserted equal in BOTH directions.
 *   The BS 2084–2085 pairs used to be pinned as a known divergence
 *   (nepali-date-converter 3.3.5 published different month lengths for
 *   those years); 3.4.2 agrees with the backend table, so they are now
 *   ordinary `inRange` pairs.
 * - `outOfRange` pairs (BS 1975 / 2100) must be rejected by the guards.
 */

interface Pair {
  ad: string;
  bs: string;
}

function parseBs(bs: string): BsDate {
  const [year, month, day] = bs.split('-').map(Number);
  return { year, month, day };
}

describe('BS golden fixture (shared with the backend)', () => {
  const pairs = golden.inRange as Pair[];

  it('covers the supported range edges and a spread of decades', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(100);
    expect(pairs.map((p) => p.bs)).toContain('2000-01-01');
    expect(pairs.map((p) => p.bs)).toContain('2090-12-30');
  });

  it.each(pairs.map((p) => [p.ad, p.bs] as const))('AD %s ↔ BS %s', (ad, bs) => {
    expect(toBsString(adToBs(ad))).toBe(bs);
    expect(bsToAd(parseBs(bs))).toBe(ad);
  });

  it.each((golden.outOfRange as Pair[]).map((p) => [p.ad, p.bs] as const))(
    'rejects out-of-range pair AD %s ↔ BS %s',
    (ad, bs) => {
      expect(() => adToBs(ad)).toThrow(BsDateError);
      expect(() => bsToAd(parseBs(bs))).toThrow(BsDateError);
    },
  );
});
