import { describe, expect, it } from 'vitest';

import {
  addPaisa,
  formatNpr,
  formatPaisa,
  multiplyPaisa,
  toDevanagariDigits,
  toPaisa,
} from './money';

describe('toPaisa', () => {
  it('parses string amounts without float error', () => {
    expect(toPaisa('19.99')).toBe(1999);
    expect(toPaisa('1234.5')).toBe(123450);
    expect(toPaisa('1000')).toBe(100000);
    expect(toPaisa('-50.25')).toBe(-5025);
  });

  it('converts numbers via string parsing, never float multiplication', () => {
    expect(toPaisa(19.99)).toBe(1999);
    // The classic float trap: 0.1 + 0.2 !== 0.3 in binary floating point.
    // Integer paisa arithmetic is exact.
    expect(addPaisa(toPaisa(0.1), toPaisa(0.2))).toBe(toPaisa(0.3));
  });

  it('rejects invalid amounts', () => {
    expect(() => toPaisa('abc')).toThrow('Invalid money amount');
    expect(() => toPaisa(Number.NaN)).toThrow('Invalid money amount');
    expect(() => toPaisa(Number.POSITIVE_INFINITY)).toThrow('Invalid money amount');
  });
});

describe('paisa arithmetic', () => {
  it('adds and multiplies as integers', () => {
    expect(addPaisa(1050, 250, -100)).toBe(1200);
    expect(multiplyPaisa(1999, 3)).toBe(5997);
  });

  it('rejects non-integer paisa (float leakage guard)', () => {
    expect(() => addPaisa(10.5)).toThrow('Paisa must be a safe integer');
    expect(() => multiplyPaisa(100, 1.5)).toThrow('Quantity must be a safe integer');
  });
});

describe('formatPaisa — Nepali lakh/crore grouping', () => {
  it('groups as 1,23,456.00', () => {
    expect(formatPaisa(toPaisa('123456'))).toBe('1,23,456.00');
    expect(formatPaisa(toPaisa('1234567.89'))).toBe('12,34,567.89');
    expect(formatPaisa(toPaisa('12345678'))).toBe('1,23,45,678.00');
  });

  it('handles small, zero, and negative amounts', () => {
    expect(formatPaisa(toPaisa('999'))).toBe('999.00');
    expect(formatPaisa(toPaisa('1234'))).toBe('1,234.00');
    expect(formatPaisa(0)).toBe('0.00');
    expect(formatPaisa(toPaisa('-123456.50'))).toBe('-1,23,456.50');
  });

  it('renders Devanagari numerals on request', () => {
    expect(formatPaisa(toPaisa('123456'), { devanagari: true })).toBe('१,२३,४५६.००');
  });
});

describe('formatNpr', () => {
  it('prefixes the NPR symbol by default', () => {
    expect(formatNpr('123456')).toBe('रू 1,23,456.00');
  });

  it('supports Devanagari numerals', () => {
    expect(formatNpr('1500.50', { devanagari: true })).toBe('रू १,५००.५०');
  });

  // Currency-symbol rule (docs/NEPALI_LOCALIZATION.md §7): screens and the
  // printed 80mm receipt use `रू`; non-Unicode channels (SMS receipts) use
  // the ASCII `NPR` prefix via the symbol option — a non-GSM-7 `रू` would
  // force UCS-2 and double the SMS segment count. No single artifact ever
  // mixes the two.
  it('pins the artifact symbol rule: रू by default, ASCII opt-out per channel', () => {
    expect(formatNpr('1500.00')).toBe('रू 1,500.00');
    expect(formatNpr('1500.00', { symbol: 'NPR ' })).toBe('NPR 1,500.00');
    expect(formatNpr('1500.00', { symbol: '' })).toBe('1,500.00');
  });
});

describe('toDevanagariDigits', () => {
  it('maps every ASCII digit', () => {
    expect(toDevanagariDigits('0123456789')).toBe('०१२३४५६७८९');
  });
});
