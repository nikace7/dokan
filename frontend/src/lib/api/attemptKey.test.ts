import { describe, expect, it } from 'vitest';

import { attemptDone, attemptKey } from '@/lib/api/client';

describe('attemptKey', () => {
  it('keeps the key for the same body until the write is done', () => {
    const first = attemptKey('hold', { lines: [1] });

    expect(attemptKey('hold', { lines: [1] })).toBe(first);
    expect(attemptKey('exchange', { lines: [1] })).not.toBe(first);

    attemptDone('hold');
    expect(attemptKey('hold', { lines: [1] })).not.toBe(first);
  });

  it('gives a changed body a new key', () => {
    const first = attemptKey('hold', { lines: [1] });

    expect(attemptKey('hold', { lines: [2] })).not.toBe(first);
  });
});
