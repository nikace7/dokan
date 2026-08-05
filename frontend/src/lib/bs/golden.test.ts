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
 * - `inRange` (~100 pairs both tables agree on, spread across BS
 *   2000–2090 with month boundaries and the supported-range edges) are
 *   asserted equal in BOTH directions.
 * - `divergent` is a KNOWN, PINNED disagreement: for BS 2084–2085 the two
 *   libraries publish different month lengths (e.g. backend
 *   nepali-datetime 1.0.8.5 has 2084 Jestha=31/Shrawan=31 where frontend
 *   nepali-date-converter 3.3.5 and the independent py-nepali have 32/32).
 *   These years are future panchanga predictions (2084 starts AD
 *   2027-04); no present-day date is affected. The test asserts the
 *   divergence exactly as recorded — if either library is re-pinned and
 *   the tables converge, this test FAILS LOUDLY and the pair must be
 *   moved to `inRange`. Do not "fix" it by editing pairs.
 * - `outOfRange` pairs (BS 1975 / 2100) must be rejected by the guards.
 */

interface Pair {
  ad: string;
  bs: string;
}

interface DivergentPair extends Pair {
  /** What the frontend table computes for `ad` (≠ `bs` by definition). */
  frontend: string;
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

  it('pins the known BS 2084–2085 table divergence (see file header)', () => {
    const divergent = golden.divergent as DivergentPair[];
    expect(divergent.length).toBeGreaterThan(0);
    for (const pair of divergent) {
      expect(pair.bs.startsWith('2084') || pair.bs.startsWith('2085')).toBe(true);
      // The frontend computes exactly its recorded value — never the
      // backend fixture's. A library re-pin changes this and must be
      // resolved consciously, not absorbed.
      expect(toBsString(adToBs(pair.ad))).toBe(pair.frontend);
      expect(pair.frontend).not.toBe(pair.bs);
    }
  });
});
