import { beforeEach, describe, expect, it } from 'vitest';

import { convertPaisa, useCurrencyStore } from '@/stores/currency';

describe('currency store', () => {
  beforeEach(() => {
    localStorage.clear();
    useCurrencyStore.setState({ base: 'NPR', display: 'NPR' });
  });

  it('converts paisa at the NRB peg (1 INR = 1.6 NPR)', () => {
    expect(convertPaisa(160000, 'NPR', 'INR')).toBe(100000);
    expect(convertPaisa(100000, 'INR', 'NPR')).toBe(160000);
    expect(convertPaisa(100, 'NPR', 'NPR')).toBe(100);
  });

  it('persists the display choice to localStorage', () => {
    useCurrencyStore.getState().setDisplay('INR');
    expect(localStorage.getItem('dokan-currency')).toBe('INR');
    expect(useCurrencyStore.getState().display).toBe('INR');
  });

  it('lets the base (tenant) currency drive the default display', () => {
    useCurrencyStore.getState().setBase('INR');
    expect(useCurrencyStore.getState().base).toBe('INR');
    expect(useCurrencyStore.getState().display).toBe('INR');
  });

  it('keeps an explicit display choice when the base lands later', () => {
    localStorage.setItem('dokan-currency', 'NPR');
    useCurrencyStore.getState().setBase('INR');
    expect(useCurrencyStore.getState().display).toBe('NPR');
  });
});
