import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_DELAY_MS, useDebounced } from '@/lib/useDebounced';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('useDebounced', () => {
  it('gives the text once typing stops, not at every key', () => {
    const seen = new Set<string>();
    const { result, rerender } = renderHook(({ text }) => useDebounced(text), {
      initialProps: { text: '' },
    });
    for (let n = 1; n <= 'sita sharma'.length; n += 1) {
      rerender({ text: 'sita sharma'.slice(0, n) });
      wait(100);
      seen.add(result.current);
    }
    expect([...seen]).toEqual(['']);

    wait(SEARCH_DELAY_MS);
    expect(result.current).toBe('sita sharma');
  });

  it('ignores spaces around the text', () => {
    const { result, rerender } = renderHook(({ text }) => useDebounced(text), {
      initialProps: { text: 'ram' },
    });
    rerender({ text: ' ram ' });
    wait(SEARCH_DELAY_MS);
    expect(result.current).toBe('ram');
  });

  it('clears at once, and forgets the old text', () => {
    const { result, rerender } = renderHook(({ text }) => useDebounced(text), {
      initialProps: { text: 'ram' },
    });
    expect(result.current).toBe('ram');
    rerender({ text: '' });
    expect(result.current).toBe('');
    wait(0);
    rerender({ text: 's' });
    expect(result.current).toBe('');
  });
});
