import { describe, expect, it } from 'vitest';

import { formatQty } from '@/lib/quantity';

describe('formatQty', () => {
  it.each([
    ['10.000', '10'],
    ['2.500', '2.5'],
    ['-1.000', '-1'],
    ['0.000', '0'],
    ['100.000', '100'],
    ['123456.000', '1,23,456'],
    [3, '3'],
    [0.1 + 0.2, '0.3'],
    [null, '—'],
    [undefined, '—'],
    ['', '—'],
    ['abc', 'abc'],
  ])('shows %s as %s', (raw, shown) => {
    expect(formatQty(raw)).toBe(shown);
  });
});
